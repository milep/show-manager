import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { PippalotAddResponse, YoutubeConfirmedVideoInput, YoutubeConfirmedVideosImportResponse, YoutubeMediaItem, YoutubePlaybackStatus, YoutubePlaylist, YoutubeQueueItem, YoutubeQueueState, YoutubeSearchResult } from "../../../shared/show-schema.js";
import type { DataRootPaths } from "./data-root.js";
import { ensureYoutubeTitleColumns, hasArtistSongParts, readYoutubeTitle, saveYoutubeTitle, type StoredYoutubeTitle, type StoredYoutubeTitleMetadata, type SaveYoutubeTitleOptions } from "./youtube-title-storage.js";

const SOURCE = "youtube";
export const PIPPALOT_PLAYLIST_ID = "pippalot";

export class PippalotPlaylistError extends Error {}

type MediaRow = {
  id: string;
  source_id: string;
  url: string;
  kind: YoutubeMediaItem["kind"];
  title: string | null;
  display_title: string | null;
  artist: string | null;
  album: string | null;
  channel: string | null;
  duration_ms: number | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
};

type QueueRow = {
  id: string;
  media_item_id: string;
  position: number;
  status: "pending" | "playing" | "completed" | "skipped" | "failed";
  added_at: string;
  started_at: string | null;
  completed_at: string | null;
  source_id: string;
  url: string;
  kind: YoutubeMediaItem["kind"];
  title: string | null;
  display_title: string | null;
  artist: string | null;
  album: string | null;
  channel: string | null;
  duration_ms: number | null;
  thumbnail_url: string | null;
};

type PlaylistRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type ConfirmedVideoRow = {
  id: string;
  video_id: string;
  title: string | null;
  display_title: string | null;
  channel: string | null;
  channel_id: string | null;
  duration_ms: number | null;
  thumbnail_url: string | null;
  source: string | null;
  confidence: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target] as T, shuffled[index] as T];
  }
  return shuffled;
}

function mapMedia(row: MediaRow): YoutubeMediaItem {
  return {
    id: row.id,
    source: SOURCE,
    sourceId: row.source_id,
    url: row.url,
    kind: row.kind,
    title: row.title,
    displayTitle: row.display_title,
    artist: row.artist,
    album: row.album,
    channel: row.channel,
    durationMs: row.duration_ms,
    thumbnailUrl: row.thumbnail_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPlaylist(row: PlaylistRow): YoutubePlaylist {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function queueTitle(row: QueueRow) {
  return row.title;
}

function queueSubtitle(row: QueueRow) {
  return row.artist ?? row.channel;
}

function normalizeSearchText(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function searchTokens(value: string) {
  return normalizeSearchText(value).split(" ").filter(Boolean);
}

function confirmedVideoMatches(row: ConfirmedVideoRow, tokens: string[]) {
  const haystack = normalizeSearchText([row.title, row.channel].filter(Boolean).join(" "));
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}

function confidenceRank(confidence: string | null) {
  if (confidence === "manual") return 0;
  if (confidence === "confirmed") return 1;
  if (confidence === "trusted-channel") return 2;
  return 3;
}

function mapConfirmedVideoSearchResult(row: ConfirmedVideoRow): YoutubeSearchResult {
  return {
    kind: "video",
    videoId: row.video_id,
    title: row.title ?? row.video_id,
    artists: [row.channel ?? "Confirmed video"],
    album: null,
    duration: null,
    durationMs: row.duration_ms,
    thumbnails: row.thumbnail_url ? [row.thumbnail_url] : [],
    confirmed: true,
  };
}

function mapQueueItem(row: QueueRow): YoutubeQueueItem {
  return {
    id: row.id,
    mediaItemId: row.media_item_id,
    videoId: row.source_id,
    url: row.url,
    title: queueTitle(row),
    displayTitle: row.display_title,
    artist: row.artist,
    album: row.album,
    channel: row.channel,
    subtitle: queueSubtitle(row),
    addedAt: row.added_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export type AddYoutubeMediaInput = {
  sourceId: string;
  url: string;
  title?: string | null;
  displayTitle?: string | null;
  artist?: string | null;
  album?: string | null;
  channel?: string | null;
  durationMs?: number | null;
  thumbnailUrl?: string | null;
  kind?: YoutubeMediaItem["kind"];
};

export class YoutubeStore {
  private readonly db: Database.Database;

  constructor(paths: DataRootPaths) {
    this.db = new Database(paths.youtubeDbFile);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  getVideoTitle(videoId: string): StoredYoutubeTitleMetadata {
    return readYoutubeTitle(this.db, videoId);
  }

  saveVideoTitle(videoId: string, value: StoredYoutubeTitle, options: SaveYoutubeTitleOptions = {}): void {
    saveYoutubeTitle(this.db, videoId, value, options);
  }

  hasConfirmedVideo(videoId: string): boolean {
    return Boolean(this.db.prepare("select 1 from youtube_confirmed_videos where video_id = ?").get(videoId));
  }

  getQueue(): YoutubeQueueState {
    const rows = this.db.prepare(`
      select q.*, m.source_id, m.url, m.kind, m.title, m.display_title, m.artist, m.album, m.channel, m.duration_ms, m.thumbnail_url
      from youtube_party_queue_items q
      join youtube_media m on m.id = q.media_item_id
      where q.status in ('pending', 'playing')
      order by q.position asc
    `).all() as QueueRow[];
    const items = rows.map(mapQueueItem);
    const current = rows.find((row) => row.status === "playing") ?? null;
    return {
      items,
      currentItemId: current?.id ?? null,
      updatedAt: this.getMeta("party_queue_updated_at") ?? nowIso(),
    };
  }

  listCompletedQueueItems(): YoutubeQueueItem[] {
    const rows = this.db.prepare(`
      select q.*, m.source_id, m.url, m.kind, m.title, m.display_title, m.artist, m.album, m.channel, m.duration_ms, m.thumbnail_url
      from youtube_party_queue_items q
      join youtube_media m on m.id = q.media_item_id
      where q.status in ('completed', 'skipped', 'failed')
      order by q.position asc
    `).all() as QueueRow[];
    return rows.map(mapQueueItem);
  }

  addToQueue(input: AddYoutubeMediaInput, placement: "end" | "next" = "end"): YoutubeQueueState {
    const media = this.upsertMedia(input);
    const now = nowIso();
    const insert = this.db.transaction(() => {
      let position = this.nextQueuePosition();
      if (placement === "next") {
        const currentPosition = this.currentQueuePosition();
        if (currentPosition !== null) {
          position = currentPosition + 1;
          this.db.prepare("update youtube_party_queue_items set position = position + 1 where status = 'pending' and position >= ?").run(position);
        }
      }
      this.db.prepare(`
        insert into youtube_party_queue_items (id, media_item_id, position, status, added_at, started_at, completed_at)
        values (?, ?, ?, 'pending', ?, null, null)
      `).run(randomUUID(), media.id, position, now);
      this.touchQueue(now);
    });
    insert();
    return this.getQueue();
  }

  markCurrentCompleted(): YoutubeQueueState {
    const now = nowIso();
    this.db.prepare("update youtube_party_queue_items set status = 'skipped', completed_at = ? where status = 'playing'").run(now);
    this.touchQueue(now);
    return this.getQueue();
  }

  clearQueue(): YoutubeQueueState {
    const now = nowIso();
    this.db.prepare("delete from youtube_party_queue_items").run();
    this.touchQueue(now);
    return this.getQueue();
  }

  setAutomationPaused(paused: boolean): void {
    this.db.prepare("insert into youtube_meta (key, value) values ('party_queue_automation_paused', ?) on conflict(key) do update set value = excluded.value").run(paused ? "true" : "false");
  }

  isAutomationPaused(): boolean {
    return this.getMeta("party_queue_automation_paused") === "true";
  }

  removeQueueItem(id: string): YoutubeQueueState {
    const now = nowIso();
    this.db.prepare("delete from youtube_party_queue_items where id = ? and status != 'playing'").run(id);
    this.touchQueue(now);
    return this.getQueue();
  }

  moveQueueItem(id: string, direction: "up" | "down"): YoutubeQueueState {
    const move = this.db.transaction(() => {
      const pending = this.db.prepare("select id, position from youtube_party_queue_items where status = 'pending' order by position asc").all() as Array<{ id: string; position: number }>;
      const index = pending.findIndex((item) => item.id === id);
      if (index === -1) return;
      const item = pending[index];
      const adjacent = pending[index + (direction === "up" ? -1 : 1)];
      if (!item || !adjacent) return;
      const update = this.db.prepare("update youtube_party_queue_items set position = ? where id = ?");
      update.run(adjacent.position, item.id);
      update.run(item.position, adjacent.id);
      this.touchQueue(nowIso());
    });
    move();
    return this.getQueue();
  }

  shuffleRest(): YoutubeQueueState {
    const pending = this.db.prepare("select id from youtube_party_queue_items where status = 'pending' order by position asc").all() as Array<{ id: string }>;
    const shuffled = [...pending].sort(() => Math.random() - 0.5);
    const update = this.db.prepare("update youtube_party_queue_items set position = ? where id = ?");
    const basePosition = this.currentQueuePosition() ?? 0;
    const now = nowIso();
    const txn = this.db.transaction(() => {
      shuffled.forEach((item, index) => update.run(basePosition + index + 1, item.id));
      this.touchQueue(now);
    });
    txn();
    return this.getQueue();
  }

  firstPending(): YoutubeQueueItem | null {
    const row = this.db.prepare(`
      select q.*, m.source_id, m.url, m.kind, m.title, m.display_title, m.artist, m.album, m.channel, m.duration_ms, m.thumbnail_url
      from youtube_party_queue_items q
      join youtube_media m on m.id = q.media_item_id
      where q.status = 'pending'
      order by q.position asc
      limit 1
    `).get() as QueueRow | undefined;
    if (!row) return null;
    return mapQueueItem(row);
  }

  markPlaying(id: string): YoutubeQueueItem | null {
    const row = this.queueRowById(id);
    if (!row) return null;
    const now = nowIso();
    this.db.prepare("update youtube_party_queue_items set status = 'playing', started_at = ? where id = ? and status = 'pending'").run(now, id);
    this.touchQueue(now);
    return { ...mapQueueItem(row), startedAt: now };
  }

  completeCurrent(): YoutubeQueueItem | null {
    const current = this.currentQueueRow();
    if (!current) return null;
    const now = nowIso();
    this.db.prepare("update youtube_party_queue_items set status = 'completed', completed_at = ? where id = ?").run(now, current.id);
    this.touchQueue(now);
    return { ...mapQueueItem(current), completedAt: now };
  }

  updateCurrentFromPlayback(playback: YoutubePlaybackStatus): void {
    const current = this.currentQueueRow();
    if (!current) return;
    const media = this.db.prepare("select * from youtube_media where id = ?").get(current.media_item_id) as MediaRow | undefined;
    if (!media) return;
    // TV observations are not source metadata and must never replace captured titles.
    this.db.prepare(`
      update youtube_media set playback_title = ?, playback_subtitle = ?, playback_album = ? where id = ?
    `).run(playback.title, playback.subtitle, playback.album, media.id);
  }

  currentStartedAt(): string | null {
    const row = this.db.prepare("select started_at from youtube_party_queue_items where status = 'playing' limit 1").get() as { started_at: string | null } | undefined;
    return row?.started_at ?? null;
  }

  listPlaylists(): YoutubePlaylist[] {
    const rows = this.db.prepare("select * from youtube_playlists order by name asc").all() as PlaylistRow[];
    return rows.map(mapPlaylist);
  }

  createPlaylist(name: string): YoutubePlaylist {
    const now = nowIso();
    const row = { id: randomUUID(), name, created_at: now, updated_at: now };
    this.db.prepare("insert into youtube_playlists (id, name, created_at, updated_at) values (?, ?, ?, ?)").run(row.id, row.name, row.created_at, row.updated_at);
    return mapPlaylist(row);
  }

  deletePlaylist(id: string): void {
    this.db.prepare("delete from youtube_playlists where id = ?").run(id);
  }

  importConfirmedVideos(items: Array<YoutubeConfirmedVideoInput & { displayTitle?: string | null }>): YoutubeConfirmedVideosImportResponse {
    const now = nowIso();
    const existing = this.db.prepare("select 1 from youtube_confirmed_videos where video_id = ? limit 1");
    const insert = this.db.prepare(`
      insert into youtube_confirmed_videos (id, video_id, title, display_title, channel, channel_id, duration_ms, thumbnail_url, source, confidence, notes, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = { imported: 0, skippedExisting: 0, invalid: 0 };
    const txn = this.db.transaction(() => {
      for (const item of items) {
        if (existing.get(item.videoId)) {
          result.skippedExisting += 1;
          continue;
        }
        const stored = this.getVideoTitle(item.videoId);
        const requiresArtistSong = hasArtistSongParts(item.title) || stored.requiresArtistSong;
        const displayTitle = [stored.displayTitle, item.displayTitle].find((value) => value?.trim() && (!requiresArtistSong || hasArtistSongParts(value))) ?? null;
        insert.run(randomUUID(), item.videoId, item.title ?? stored.title, displayTitle, item.channel ?? null, item.channelId ?? null, item.durationMs ?? null, item.thumbnailUrl ?? null, item.source ?? null, item.confidence ?? null, item.notes ?? null, now, now);
        result.imported += 1;
      }
    });
    txn();
    return result;
  }

  searchConfirmedVideos(query: string): YoutubeSearchResult[] {
    const tokens = searchTokens(query);
    if (!tokens.length) return [];
    const rows = this.db.prepare("select * from youtube_confirmed_videos order by updated_at desc").all() as ConfirmedVideoRow[];
    return rows
      .filter((row) => confirmedVideoMatches(row, tokens))
      .sort((left, right) => confidenceRank(left.confidence) - confidenceRank(right.confidence))
      .slice(0, 25)
      .map(mapConfirmedVideoSearchResult);
  }

  addToPippalot(input: AddYoutubeMediaInput): PippalotAddResponse {
    const append = this.db.transaction(() => {
      const playlist = this.db.prepare("select 1 from youtube_playlists where id = ?").get(PIPPALOT_PLAYLIST_ID);
      if (!playlist) {
        throw new PippalotPlaylistError("Pippalot playlist is not cached.");
      }
      const duplicate = this.db.prepare(`
        select 1
        from youtube_playlist_items i
        join youtube_media m on m.id = i.media_item_id
        where i.playlist_id = ? and m.source_id = ?
        limit 1
      `).get(PIPPALOT_PLAYLIST_ID, input.sourceId);
      if (duplicate) {
        return { outcome: "duplicate" as const, videoId: input.sourceId };
      }

      const media = this.upsertMedia(input);
      const row = this.db.prepare("select coalesce(max(position), 0) + 1 as position from youtube_playlist_items where playlist_id = ?").get(PIPPALOT_PLAYLIST_ID) as { position: number };
      const now = nowIso();
      this.db.prepare(`
        insert into youtube_playlist_items (id, playlist_id, media_item_id, position, added_at)
        values (?, ?, ?, ?, ?)
      `).run(randomUUID(), PIPPALOT_PLAYLIST_ID, media.id, row.position, now);
      this.db.prepare("update youtube_playlists set updated_at = ? where id = ?").run(now, PIPPALOT_PLAYLIST_ID);
      return { outcome: "added" as const, videoId: input.sourceId };
    });
    return append();
  }

  loadPippalotToQueue(): { queued: number } {
    const playlist = this.db.prepare("select 1 from youtube_playlists where id = ?").get(PIPPALOT_PLAYLIST_ID);
    if (!playlist) {
      throw new PippalotPlaylistError("Pippalot playlist is not cached.");
    }
    const rows = this.db.prepare("select media_item_id from youtube_playlist_items where playlist_id = ? order by position asc").all(PIPPALOT_PLAYLIST_ID) as Array<{ media_item_id: string }>;
    if (!rows.length) {
      throw new PippalotPlaylistError("Pippalot playlist is empty.");
    }
    const shuffled = shuffle(rows);
    const now = nowIso();
    const insert = this.db.prepare(`
      insert into youtube_party_queue_items (id, media_item_id, position, status, added_at, started_at, completed_at)
      values (?, ?, ?, 'pending', ?, null, null)
    `);
    const txn = this.db.transaction(() => {
      this.db.prepare("delete from youtube_party_queue_items").run();
      shuffled.forEach((row, index) => {
        insert.run(randomUUID(), row.media_item_id, index + 1, now);
      });
      this.touchQueue(now);
    });
    txn();
    return { queued: shuffled.length };
  }

  loadConfirmedVideosToQueue(): { queued: number } {
    const rows = this.db.prepare(`
      select *
      from youtube_confirmed_videos
      where id in (select min(id) from youtube_confirmed_videos group by video_id)
    `).all() as ConfirmedVideoRow[];
    const shuffled = [...rows].sort(() => Math.random() - 0.5);
    const now = nowIso();
    const insert = this.db.prepare(`
      insert into youtube_party_queue_items (id, media_item_id, position, status, added_at, started_at, completed_at)
      values (?, ?, ?, 'pending', ?, null, null)
    `);
    const txn = this.db.transaction(() => {
      this.db.prepare("delete from youtube_party_queue_items").run();
      shuffled.forEach((row, index) => {
        const media = this.upsertMedia({
          sourceId: row.video_id,
          url: `https://www.youtube.com/watch?v=${row.video_id}`,
          title: row.title,
          displayTitle: row.display_title,
          channel: row.channel,
          durationMs: row.duration_ms,
          thumbnailUrl: row.thumbnail_url,
          kind: "video",
        });
        insert.run(randomUUID(), media.id, index + 1, now);
      });
      this.touchQueue(now);
    });
    txn();
    return { queued: shuffled.length };
  }

  loadPlaylistToQueue(id: string, mode: "append" | "replace" = "append"): YoutubeQueueState {
    const now = nowIso();
    const txn = this.db.transaction(() => {
      if (mode === "replace") {
        this.db.prepare("delete from youtube_party_queue_items").run();
      }
      const rows = this.db.prepare("select media_item_id from youtube_playlist_items where playlist_id = ? order by position asc").all(id) as Array<{ media_item_id: string }>;
      const insert = this.db.prepare(`
        insert into youtube_party_queue_items (id, media_item_id, position, status, added_at, started_at, completed_at)
        values (?, ?, ?, 'pending', ?, null, null)
      `);
      let position = this.nextQueuePosition();
      for (const row of rows) {
        insert.run(randomUUID(), row.media_item_id, position, now);
        position += 1;
      }
      this.touchQueue(now);
    });
    txn();
    return this.getQueue();
  }

  private upsertMedia(input: AddYoutubeMediaInput): YoutubeMediaItem {
    const stored = this.getVideoTitle(input.sourceId);
    input = { ...input, title: stored.title ?? input.title ?? null, displayTitle: stored.displayTitle ?? input.displayTitle ?? null };
    const existing = this.db.prepare("select * from youtube_media where source_id = ?").get(input.sourceId) as MediaRow | undefined;
    const now = nowIso();
    if (existing) {
      this.db.prepare(`
        update youtube_media
        set url = ?, title = coalesce(title, ?), display_title = coalesce(display_title, ?), artist = coalesce(?, artist), album = coalesce(?, album), channel = coalesce(?, channel), duration_ms = coalesce(?, duration_ms), thumbnail_url = coalesce(?, thumbnail_url), kind = ?, updated_at = ?
        where id = ?
      `).run(input.url, input.title ?? null, input.displayTitle ?? null, input.artist ?? null, input.album ?? null, input.channel ?? null, input.durationMs ?? null, input.thumbnailUrl ?? null, input.kind ?? existing.kind, now, existing.id);
      const updated = this.db.prepare("select * from youtube_media where id = ?").get(existing.id) as MediaRow;
      return mapMedia(updated);
    }
    const row: MediaRow = {
      id: randomUUID(),
      source_id: input.sourceId,
      url: input.url,
      kind: input.kind ?? "unknown",
      title: input.title ?? null,
      display_title: input.displayTitle ?? null,
      artist: input.artist ?? null,
      album: input.album ?? null,
      channel: input.channel ?? null,
      duration_ms: input.durationMs ?? null,
      thumbnail_url: input.thumbnailUrl ?? null,
      created_at: now,
      updated_at: now,
    };
    this.db.prepare(`
      insert into youtube_media (id, source_id, url, kind, title, display_title, artist, album, channel, duration_ms, thumbnail_url, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.id, row.source_id, row.url, row.kind, row.title, row.display_title, row.artist, row.album, row.channel, row.duration_ms, row.thumbnail_url, row.created_at, row.updated_at);
    return mapMedia(row);
  }

  private nextQueuePosition(): number {
    const row = this.db.prepare("select coalesce(max(position), 0) + 1 as position from youtube_party_queue_items").get() as { position: number };
    return row.position;
  }

  private currentQueuePosition(): number | null {
    const row = this.db.prepare("select position from youtube_party_queue_items where status = 'playing' limit 1").get() as { position: number } | undefined;
    return row?.position ?? null;
  }

  private currentQueueRow(): QueueRow | null {
    const row = this.db.prepare(`
      select q.*, m.source_id, m.url, m.kind, m.title, m.display_title, m.artist, m.album, m.channel, m.duration_ms, m.thumbnail_url
      from youtube_party_queue_items q
      join youtube_media m on m.id = q.media_item_id
      where q.status = 'playing'
      limit 1
    `).get() as QueueRow | undefined;
    return row ?? null;
  }

  private queueRowById(id: string): QueueRow | null {
    const row = this.db.prepare(`
      select q.*, m.source_id, m.url, m.kind, m.title, m.display_title, m.artist, m.album, m.channel, m.duration_ms, m.thumbnail_url
      from youtube_party_queue_items q
      join youtube_media m on m.id = q.media_item_id
      where q.id = ?
      limit 1
    `).get(id) as QueueRow | undefined;
    return row ?? null;
  }

  private getMeta(key: string): string | null {
    const row = this.db.prepare("select value from youtube_meta where key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private touchQueue(value: string): void {
    this.db.prepare("insert into youtube_meta (key, value) values ('party_queue_updated_at', ?) on conflict(key) do update set value = excluded.value").run(value);
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists youtube_meta (
        key text primary key,
        value text not null
      );

      create table if not exists youtube_media (
        id text primary key,
        source_id text not null unique,
        url text not null,
        kind text not null,
        title text,
        artist text,
        album text,
        channel text,
        duration_ms integer,
        thumbnail_url text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists youtube_playlists (
        id text primary key,
        name text not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists youtube_playlist_items (
        id text primary key,
        playlist_id text not null references youtube_playlists(id) on delete cascade,
        media_item_id text not null references youtube_media(id),
        position integer not null,
        added_at text not null
      );

      create table if not exists youtube_party_queue_items (
        id text primary key,
        media_item_id text not null references youtube_media(id),
        position integer not null,
        status text not null,
        added_at text not null,
        started_at text,
        completed_at text
      );

      create table if not exists youtube_confirmed_videos (
        id text primary key,
        video_id text not null,
        title text,
        channel text,
        channel_id text,
        duration_ms integer,
        thumbnail_url text,
        source text,
        confidence text,
        notes text,
        created_at text not null,
        updated_at text not null
      );

      create index if not exists youtube_confirmed_videos_video_id_idx on youtube_confirmed_videos(video_id);
      create index if not exists youtube_party_queue_position_idx on youtube_party_queue_items(position);
      create index if not exists youtube_party_queue_status_idx on youtube_party_queue_items(status);
    `);
    ensureYoutubeTitleColumns(this.db);
  }
}
