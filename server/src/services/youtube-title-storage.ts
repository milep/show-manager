import type Database from "better-sqlite3";
import type { YoutubeMediaKind } from "../../../shared/show-schema.js";

export type StoredYoutubeTitle = { title: string | null; displayTitle: string | null };
export type StoredYoutubeTitleMetadata = StoredYoutubeTitle & {
  kind: YoutubeMediaKind | null; artist: string | null;
  sourceTitle: string | null; confirmedSource: boolean;
  requiresArtistSong: boolean; needsCleanup: boolean; incompleteDisplay: boolean;
};

// A format guard, not a music classifier. Callers establish music/artist context first.
export function hasArtistSongParts(title: string | null | undefined): boolean {
  if (!title) return false;
  const separator = /\s[-–—]\s/.exec(title);
  return Boolean(separator && title.slice(0, separator.index).trim() && title.slice(separator.index + separator[0].length).trim());
}

// A small additive upgrade shared with the manual SQLite writers. No data rewrite.
export function ensureYoutubeTitleColumns(db: Database.Database): void {
  for (const table of ["youtube_media", "youtube_confirmed_videos"]) {
    const columns = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "display_title")) db.exec(`alter table ${table} add column display_title text`);
  }
  const columns = db.prepare("pragma table_info(youtube_media)").all() as Array<{ name: string }>;
  for (const name of ["playback_title", "playback_subtitle", "playback_album"]) {
    if (!columns.some((column) => column.name === name)) db.exec(`alter table youtube_media add column ${name} text`);
  }
}

export function readYoutubeTitle(db: Database.Database, videoId: string): StoredYoutubeTitleMetadata {
  const rows = db.prepare(`
    select title, display_title, kind, artist, 0 as confirmed from youtube_media where source_id = ?
    union all
    select title, display_title, null as kind, null as artist, 1 as confirmed from youtube_confirmed_videos where video_id = ?
  `).all(videoId, videoId) as Array<{ title: string | null; display_title: string | null; kind: YoutubeMediaKind | null; artist: string | null; confirmed: number }>;
  const original = rows.find((row) => row.title?.trim());
  const sourceTitle = rows.find((row) => hasArtistSongParts(row.title))?.title ?? original?.title ?? null;
  const confirmedSource = rows.some((row) => row.confirmed === 1);
  const kind = rows.find((row) => row.kind !== null)?.kind ?? null;
  const requiresArtistSong = Boolean(original?.artist?.trim() && original.title?.trim())
    || ((confirmedSource || kind === "music") && hasArtistSongParts(sourceTitle));
  const usable = (value: string | null) => Boolean(value?.trim()) && (!requiresArtistSong || hasArtistSongParts(value));
  return {
    title: original?.title ?? null,
    displayTitle: rows.find((row) => usable(row.display_title))?.display_title ?? rows.find((row) => row.display_title?.trim())?.display_title ?? null,
    kind,
    artist: original?.artist ?? null,
    sourceTitle, confirmedSource, requiresArtistSong,
    needsCleanup: rows.length === 0 || rows.some((row) => !usable(row.display_title)),
    incompleteDisplay: requiresArtistSong && rows.some((row) => Boolean(row.display_title?.trim()) && !hasArtistSongParts(row.display_title)),
  };
}

export type SaveYoutubeTitleOptions = { replaceDisplay?: boolean; requiresArtistSong?: boolean };

export function saveYoutubeTitle(db: Database.Database, videoId: string, value: StoredYoutubeTitle, options: SaveYoutubeTitleOptions = {}): void {
  const save = db.transaction(() => {
    const stored = readYoutubeTitle(db, videoId);
    const requiresArtistSong = stored.requiresArtistSong || Boolean(options.requiresArtistSong);
    const displayTitle = requiresArtistSong && !hasArtistSongParts(value.displayTitle) ? null : value.displayTitle;
    const repair = requiresArtistSong && hasArtistSongParts(displayTitle);
    // Default writes repair only missing/incomplete fields, never another complete display.
    for (const [table, key] of [["youtube_media", "source_id"], ["youtube_confirmed_videos", "video_id"]] as const) {
      const rows = db.prepare(`select id, display_title from ${table} where ${key} = ?`).all(videoId) as Array<{ id: string; display_title: string | null }>;
      const update = db.prepare(`update ${table} set title = coalesce(nullif(title, ''), ?), display_title = ? where id = ?`);
      for (const row of rows) {
        const canReplace = displayTitle && (options.replaceDisplay || !row.display_title?.trim() || (repair && !hasArtistSongParts(row.display_title)));
        update.run(value.title, canReplace ? displayTitle : row.display_title, row.id);
      }
    }
  });
  save();
}
