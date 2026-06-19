#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { basename } from "node:path";

function usage() {
  console.error(`Usage: ${basename(process.argv[1])} <playlist-or-channel-url> [--confidence confirmed|trusted-channel|manual] [--source label] [--out file]`);
}

function playlistId(value) {
  try {
    return new URL(value).searchParams.get("list");
  } catch {
    return null;
  }
}

function channelHandle(value) {
  const match = /youtube\.com\/(@[^/?#]+)/i.exec(value);
  return match?.[1] ?? null;
}

function defaultSource(value) {
  const handle = channelHandle(value);
  if (handle) return `channel:${handle.slice(1)}`;
  const list = playlistId(value);
  if (list) return `playlist:${list}`;
  return value;
}

function defaultConfidence(value) {
  return channelHandle(value) ? "trusted-channel" : "confirmed";
}

const args = process.argv.slice(2);
const url = args.shift();
if (!url || url.startsWith("--")) {
  usage();
  process.exit(1);
}

let confidence = defaultConfidence(url);
let source = defaultSource(url);
const fallbackChannel = channelHandle(url)?.slice(1);
let outFile = null;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const value = args[index + 1];
  if (arg === "--confidence" && value) {
    confidence = value;
    index += 1;
  } else if (arg === "--source" && value) {
    source = value;
    index += 1;
  } else if (arg === "--out" && value) {
    outFile = value;
    index += 1;
  } else {
    usage();
    process.exit(1);
  }
}

const output = outFile ? createWriteStream(outFile, { flags: "a" }) : process.stdout;
const scraped = await scrapeWithYtDlp(url);
const expectedCount = await playlistExpectedCount(url);
const list = playlistId(url);
if (list && scraped.length >= 100) {
  const apiItems = await scrapePlaylistWithApi(list);
  for (const raw of apiItems.length > scraped.length ? apiItems : scraped) writeItem(raw);
} else if (list && expectedCount !== null && expectedCount > scraped.length) {
  const apiItems = await scrapePlaylistWithApi(list);
  for (const raw of apiItems.length > scraped.length ? apiItems : scraped) writeItem(raw);
} else {
  for (const raw of scraped) writeItem(raw);
}
if (outFile) output.end();

async function scrapeWithYtDlp(targetUrl) {
  const child = spawn("yt-dlp", ["--flat-playlist", "--dump-json", targetUrl], { stdio: ["ignore", "pipe", "inherit"] });
  let buffer = "";
  const items = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) items.push(JSON.parse(line));
  });
  child.stdout.on("end", () => {
    if (buffer.trim()) items.push(JSON.parse(buffer));
  });
  const [code] = await once(child, "close");
  if (code !== 0) process.exitCode = code ?? 1;
  return items;
}

async function playlistExpectedCount(targetUrl) {
  if (!playlistId(targetUrl)) return null;
  const child = spawn("yt-dlp", ["--flat-playlist", "--dump-single-json", targetUrl], { stdio: ["ignore", "pipe", "ignore"] });
  let text = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    text += chunk;
  });
  const [code] = await once(child, "close");
  if (code !== 0 || !text.trim()) return null;
  const data = JSON.parse(text);
  return typeof data.playlist_count === "number" ? data.playlist_count : null;
}

function youtubeApiKey() {
  if (process.env.YOUTUBE_DATA_API_KEY) return process.env.YOUTUBE_DATA_API_KEY;
  for (const file of ["/home/devops/secrets/dev/show-manager.secrets.env", "/home/devops/config/dev/show-manager.env"]) {
    try {
      const match = /^YOUTUBE_DATA_API_KEY=(.*)$/m.exec(readFileSync(file, "utf8"));
      if (match?.[1]) return match[1].trim().replace(/^['\"]|['\"]$/g, "");
    } catch {
      // Optional local convenience.
    }
  }
  return null;
}

async function scrapePlaylistWithApi(list) {
  const key = youtubeApiKey();
  if (!key) {
    console.error("Playlist has more items than yt-dlp returned. Set YOUTUBE_DATA_API_KEY for API fallback.");
    return [];
  }
  const items = [];
  let pageToken = "";
  do {
    const pageUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    pageUrl.searchParams.set("part", "snippet,contentDetails");
    pageUrl.searchParams.set("maxResults", "50");
    pageUrl.searchParams.set("playlistId", list);
    pageUrl.searchParams.set("key", key);
    if (pageToken) pageUrl.searchParams.set("pageToken", pageToken);
    const response = await fetch(pageUrl);
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message ?? `YouTube Data API failed with status ${response.status}`);
    for (const item of body.items ?? []) {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
      items.push({
        id: videoId,
        title: item.snippet?.title,
        channel: item.snippet?.videoOwnerChannelTitle,
        channel_id: item.snippet?.videoOwnerChannelId,
        thumbnail: bestThumbnail(item.snippet?.thumbnails),
      });
    }
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return items;
}

function bestThumbnail(thumbnails) {
  if (!thumbnails || typeof thumbnails !== "object") return undefined;
  return thumbnails.maxres?.url ?? thumbnails.standard?.url ?? thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url;
}

function writeItem(raw) {
  const videoId = raw.id ?? raw.video_id;
  if (typeof videoId !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;
  const item = {
    videoId,
    title: typeof raw.title === "string" ? raw.title : undefined,
    channel: typeof raw.channel === "string" ? raw.channel : typeof raw.uploader === "string" ? raw.uploader : fallbackChannel,
    channelId: typeof raw.channel_id === "string" ? raw.channel_id : typeof raw.uploader_id === "string" ? raw.uploader_id : undefined,
    durationMs: typeof raw.duration === "number" ? Math.round(raw.duration * 1000) : undefined,
    thumbnailUrl: typeof raw.thumbnail === "string" && raw.thumbnail.startsWith("http") ? raw.thumbnail : undefined,
    source,
    confidence,
  };
  output.write(`${JSON.stringify(Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)))}\n`);
}
