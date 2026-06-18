const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/;

export class YoutubeLinkError extends Error {}

export type ParsedYoutubeLink = {
  videoId: string;
  canonicalUrl: string;
};

export function parseYoutubeLink(input: string): ParsedYoutubeLink {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new YoutubeLinkError("YouTube link is required.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new YoutubeLinkError("Invalid YouTube link.");
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let videoId: string | null = null;

  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? null;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v");
    } else if (url.pathname.startsWith("/shorts/")) {
      videoId = url.pathname.split("/").filter(Boolean)[1] ?? null;
    }
  }

  if (!videoId || !youtubeIdPattern.test(videoId)) {
    throw new YoutubeLinkError("YouTube link must contain an 11-character video id.");
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
