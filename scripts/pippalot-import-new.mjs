#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import Database from "better-sqlite3";

const SOURCE_PLAYLIST_ID = "PLM3I17KSuAh94g74QlLDFMy1RBFuarkjU";
const CACHED_PLAYLIST_ID = "pippalot";
const DEFAULT_DB_FILE = "/home/devops/data/dev/show-manager/state/youtube.sqlite";

function usage() {
  console.error(`Usage: ${basename(process.argv[1])} [--db /path/youtube.sqlite]`);
}

function youtubeApiKey() {
  if (process.env.YOUTUBE_DATA_API_KEY) return process.env.YOUTUBE_DATA_API_KEY;
  for (const file of ["/home/devops/secrets/dev/show-manager.secrets.env", "/home/devops/config/dev/show-manager.env"]) {
    try {
      const match = /^\s*(?:export\s+)?YOUTUBE_DATA_API_KEY\s*=\s*(.*)\s*$/m.exec(readFileSync(file, "utf8"));
      if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
    } catch {
      // The process environment remains the portable path.
    }
  }
  return null;
}

function bestThumbnail(thumbnails) {
  if (!thumbnails || typeof thumbnails !== "object") return null;
  return thumbnails.maxres?.url ?? thumbnails.standard?.url ?? thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? null;
}

async function fetchPlaylistItems(apiKey) {
  const items = [];
  let pageToken = "";
  let pages = 0;
  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("playlistId", SOURCE_PLAYLIST_ID);
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `YouTube Data API failed with status ${response.status}`);
    }
    pages += 1;
    for (const item of body.items ?? []) {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
      if (typeof videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;
      items.push({
        videoId,
        title: typeof item.snippet?.title === "string" ? item.snippet.title : null,
        channel: typeof item.snippet?.videoOwnerChannelTitle === "string" ? item.snippet.videoOwnerChannelTitle : null,
        thumbnailUrl: bestThumbnail(item.snippet?.thumbnails),
      });
    }
    pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : "";
  } while (pageToken);

  return { pages, items: [...new Map(items.map((item) => [item.videoId, item])).values()] };
}

let dbFile = DEFAULT_DB_FILE;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const value = args[index + 1];
  if (arg === "--db" && value) {
    dbFile = value;
    index += 1;
  } else {
    usage();
    process.exit(1);
  }
}

const apiKey = youtubeApiKey();
if (!apiKey) {
  console.error("Set YOUTUBE_DATA_API_KEY or run where the show-manager secrets file is readable.");
  process.exit(1);
}

const fetched = await fetchPlaylistItems(apiKey);
const db = new Database(dbFile);
try {
  const playlist = db.prepare("select 1 from youtube_playlists where id = ?").get(CACHED_PLAYLIST_ID);
  if (!playlist) throw new Error("Pippalot playlist is not cached.");

  const cachedRows = db.prepare(`
    select m.source_id
    from youtube_playlist_items i
    join youtube_media m on m.id = i.media_item_id
    where i.playlist_id = ?
  `).all(CACHED_PLAYLIST_ID);
  const cachedIds = new Set(cachedRows.map((row) => row.source_id));
  const missing = fetched.items.filter((item) => !cachedIds.has(item.videoId));

  if (!missing.length) {
    console.log(JSON.stringify({ pages: fetched.pages, fetched: fetched.items.length, cachedBefore: cachedRows.length, added: 0, cachedAfter: cachedRows.length, backupFile: null }, null, 2));
    process.exitCode = 0;
  } else {
    const backupFile = `${dbFile}.backup-before-pippalot-import-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await db.backup(backupFile);
    const now = new Date().toISOString();
    const existingMedia = db.prepare("select id from youtube_media where source_id = ?");
    const insertMedia = db.prepare(`
      insert into youtube_media (id, source_id, url, kind, title, artist, album, channel, duration_ms, thumbnail_url, created_at, updated_at)
      values (?, ?, ?, 'video', ?, null, null, ?, null, ?, ?, ?)
    `);
    const insertPlaylistItem = db.prepare(`
      insert into youtube_playlist_items (id, playlist_id, media_item_id, position, added_at)
      values (?, ?, ?, ?, ?)
    `);
    const positionRow = db.prepare("select coalesce(max(position), 0) as position from youtube_playlist_items where playlist_id = ?").get(CACHED_PLAYLIST_ID);

    const append = db.transaction(() => {
      let position = positionRow.position;
      for (const item of missing) {
        const existing = existingMedia.get(item.videoId);
        const mediaId = existing?.id ?? randomUUID();
        if (!existing) {
          insertMedia.run(mediaId, item.videoId, `https://www.youtube.com/watch?v=${item.videoId}`, item.title, item.channel, item.thumbnailUrl, now, now);
        }
        position += 1;
        insertPlaylistItem.run(randomUUID(), CACHED_PLAYLIST_ID, mediaId, position, now);
      }
      db.prepare("update youtube_playlists set updated_at = ? where id = ?").run(now, CACHED_PLAYLIST_ID);
    });
    append();

    console.log(JSON.stringify({ pages: fetched.pages, fetched: fetched.items.length, cachedBefore: cachedRows.length, added: missing.length, cachedAfter: cachedRows.length + missing.length, backupFile }, null, 2));
  }
} finally {
  db.close();
}
