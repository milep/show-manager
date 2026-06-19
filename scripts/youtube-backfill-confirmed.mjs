#!/usr/bin/env node
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

function usage() {
  console.error(`Usage: ${basename(process.argv[1])} [--db /path/youtube.sqlite] [--limit count]`);
}

let dbFile = "/home/devops/data/dev/show-manager/state/youtube.sqlite";
let limit = null;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const value = args[index + 1];
  if (arg === "--db" && value) {
    dbFile = value;
    index += 1;
  } else if (arg === "--limit" && value) {
    limit = Number(value);
    index += 1;
  } else {
    usage();
    process.exit(1);
  }
}

function youtubeApiKey() {
  if (process.env.YOUTUBE_DATA_API_KEY) return process.env.YOUTUBE_DATA_API_KEY;
  for (const file of ["/home/devops/secrets/dev/show-manager.secrets.env", "/home/devops/config/dev/show-manager.env"]) {
    try {
      const match = /^YOUTUBE_DATA_API_KEY=(.*)$/m.exec(readFileSync(file, "utf8"));
      if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
    } catch {
      // Optional local convenience.
    }
  }
  return null;
}

function bestThumbnail(thumbnails) {
  if (!thumbnails || typeof thumbnails !== "object") return null;
  return thumbnails.maxres?.url ?? thumbnails.standard?.url ?? thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? null;
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

const key = youtubeApiKey();
if (!key) {
  console.error("Set YOUTUBE_DATA_API_KEY or run where the show-manager secrets file is readable.");
  process.exit(1);
}

const db = new Database(dbFile);
const rows = db.prepare(`
  select video_id
  from youtube_confirmed_videos
  where thumbnail_url is null or channel is null or channel_id is null
  order by created_at asc
  ${limit === null ? "" : "limit ?"}
`).all(...(limit === null ? [] : [limit]));

const update = db.prepare(`
  update youtube_confirmed_videos
  set title = coalesce(?, title),
      channel = coalesce(?, channel),
      channel_id = coalesce(?, channel_id),
      thumbnail_url = coalesce(?, thumbnail_url),
      updated_at = ?
  where video_id = ?
`);

let updated = 0;
let missing = 0;
for (const batch of chunks(rows, 50)) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("id", batch.map((row) => row.video_id).join(","));
  url.searchParams.set("key", key);
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? `YouTube Data API failed with status ${response.status}`);
  const found = new Set();
  const now = new Date().toISOString();
  const txn = db.transaction((items) => {
    for (const item of items) {
      found.add(item.id);
      update.run(item.snippet?.title ?? null, item.snippet?.channelTitle ?? null, item.snippet?.channelId ?? null, bestThumbnail(item.snippet?.thumbnails), now, item.id);
      updated += 1;
    }
  });
  txn(body.items ?? []);
  missing += batch.filter((row) => !found.has(row.video_id)).length;
}

db.close();
console.log(JSON.stringify({ checked: rows.length, updated, missing }, null, 2));
