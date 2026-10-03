import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AddYoutubeMediaInput } from "./youtube-store.js";
import { hasArtistSongParts, type StoredYoutubeTitle, type StoredYoutubeTitleMetadata, type SaveYoutubeTitleOptions } from "./youtube-title-storage.js";

export const OPENROUTER_TITLE_MODEL = "~z-ai/glm-flash-latest";
export const TITLE_INSTRUCTION = `You clean up YouTube music video titles.

Return only the cleaned title in this exact format:
Artist - Song Title

Remove unrelated text such as:
- record label/channel names
- OFFICIAL VIDEO / OFFICIAL MUSIC VIDEO / OFFICIAL AUDIO
- lyric video / visualizer
- resolution tags such as 4K or HD
- redundant repeated artist names
- unnecessary brackets or parentheses containing video metadata

Preserve the actual artist name and song title.

Examples:

Century Media Records - MARDUK - Shovel Beats Sceptre (OFFICIAL VIDEO)
=> MARDUK - Shovel Beats Sceptre

Dark Funeral - Let the Devil In
=> Dark Funeral - Let the Devil In

Marilyn Manson - The Fight Song
=> Marilyn Manson - The Fight Song

Marilyn Manson - Marilyn Manson - Front Toward Enemy (Music Video)
=> Marilyn Manson - Front Toward Enemy

Nuclear Blast Records - SEPTICFLESH - Neuromancer (OFFICIAL MUSIC VIDEO)
=> SEPTICFLESH - Neuromancer

Nuclear Blast Records - KREATOR - Gods Of Violence (OFFICIAL VIDEO)
=> KREATOR - Gods Of Violence

Return only the final cleaned title. Do not include quotes, JSON, markdown, explanations, or any other text.` + "\nLeave non-music titles unchanged. Preserve meaningful live, remix and featured-artist qualifiers.";

export function loadOpenRouterKey(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.OPENROUTER_API_KEY !== undefined) return env.OPENROUTER_API_KEY.trim() || null;
  if (!env.HOME) return null;
  try {
    const text = readFileSync(path.join(env.HOME, ".config/secrets/openrouter.env"), "utf8");
    const value = /^\s*(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.*?)\s*$/m.exec(text)?.[1];
    if (!value) return null;
    if (value.startsWith('"') || value.startsWith("'")) {
      const end = value.indexOf(value[0]!, 1);
      return end === -1 ? null : value.slice(1, end).trim() || null;
    }
    return value.replace(/\s+#.*$/, "").trim() || null;
  } catch {
    return null;
  }
}

const metadataSchema = z.object({ title: z.string().min(1).refine((title) => Boolean(title.trim())), author_name: z.string().trim().min(1).optional() });
const completionSchema = z.object({ choices: z.array(z.object({
  // Explicit truncation/filter/error/tool termination is not a usable title.
  finish_reason: z.literal("stop").optional(),
  message: z.object({ content: z.string().trim().min(1) }),
})).min(1) });

type TitleStore = {
  getVideoTitle(videoId: string): StoredYoutubeTitleMetadata;
  saveVideoTitle(videoId: string, value: StoredYoutubeTitle, options?: SaveYoutubeTitleOptions): void;
};

export class YoutubeTitleService {
  constructor(
    private readonly store: TitleStore,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly key: () => string | null = loadOpenRouterKey,
  ) {}

  async prepare(input: AddYoutubeMediaInput, options: { refreshDisplay?: boolean; confirmedSource?: boolean; signal?: AbortSignal } = {}): Promise<AddYoutubeMediaInput> {
    options.signal?.throwIfAborted();
    const stored = this.store.getVideoTitle(input.sourceId);
    // ID-only/video-shaped additions must retain the known stored music role.
    if (stored.kind === "music") input = { ...input, kind: "music" };
    if (stored.artist?.trim() && stored.title) {
      input = { ...input, kind: "music", artist: stored.artist, title: stored.title };
    }
    let title = stored.title ?? input.title ?? null;
    let channel = input.channel ?? null;
    // Keep the baseline separate from richer same-ID context (including this addition).
    let sourceTitle = hasArtistSongParts(stored.sourceTitle) ? stored.sourceTitle
      : hasArtistSongParts(input.title) ? input.title! : stored.sourceTitle ?? title;
    const structuredTitle = input.kind === "music" && input.artist?.trim() && input.title?.trim()
      ? (input.title.toLocaleLowerCase().startsWith(`${input.artist.trim().toLocaleLowerCase()} - `) ? input.title.trim() : `${input.artist.trim()} - ${input.title.trim()}`) : null;
    const invalidDisplay = (stored.requiresArtistSong || Boolean(structuredTitle) || ((options.confirmedSource || input.kind === "music") && hasArtistSongParts(sourceTitle))) && !hasArtistSongParts(stored.displayTitle);
    let displayTitle = options.refreshDisplay || invalidDisplay ? null : stored.displayTitle;
    // Retrieval is context enrichment, never separator/channel-based music classification.
    const needsContext = !structuredTitle && !displayTitle && !hasArtistSongParts(sourceTitle);
    if (needsContext) {
      sourceTitle = null;
      try {
        const url = new URL("https://www.youtube.com/oembed");
        url.searchParams.set("url", `https://www.youtube.com/watch?v=${input.sourceId}`);
        url.searchParams.set("format", "json");
        const timeout = AbortSignal.timeout(8_000);
        const response = await this.fetchImpl(url, { signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout });
        if (response.ok) {
          const metadata = metadataSchema.parse(await response.json());
          sourceTitle = metadata.title;
          title ??= metadata.title;
          channel ??= metadata.author_name ?? null;
        }
      } catch {
        // Unavailable/private videos must still be addable.
      }
    }
    options.signal?.throwIfAborted();
    const requiresArtistSong = stored.requiresArtistSong || Boolean(structuredTitle)
      || Boolean((stored.confirmedSource || options.confirmedSource || options.refreshDisplay || input.kind === "music") && hasArtistSongParts(sourceTitle));
    if (!displayTitle) {
      displayTitle = structuredTitle ?? (sourceTitle ? await this.clean(sourceTitle, options.signal) : null);
      if (requiresArtistSong && !hasArtistSongParts(displayTitle)) displayTitle = null;
    }
    options.signal?.throwIfAborted();
    this.store.saveVideoTitle(input.sourceId, { title, displayTitle }, { replaceDisplay: Boolean(options.refreshDisplay), requiresArtistSong });
    return { ...input, title, channel, displayTitle };
  }

  private async clean(title: string, signal?: AbortSignal): Promise<string | null> {
    try {
      const key = this.key();
      if (!key) return null;
      const timeout = AbortSignal.timeout(10_000);
      const response = await this.fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
        body: JSON.stringify({
          model: OPENROUTER_TITLE_MODEL, temperature: 0.1, max_tokens: 160,
          reasoning: { enabled: false },
          messages: [{ role: "system", content: TITLE_INSTRUCTION }, { role: "user", content: title }],
        }),
      });
      if (!response.ok) return null;
      return completionSchema.parse(await response.json()).choices[0]!.message.content;
    } catch {
      // Do not log provider errors: they may contain credentials or request headers.
      return null;
    }
  }
}
