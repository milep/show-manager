#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
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
const child = spawn("yt-dlp", ["--flat-playlist", "--dump-json", url], { stdio: ["ignore", "pipe", "inherit"] });
let buffer = "";

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) writeItem(line);
});
child.stdout.on("end", () => {
  if (buffer.trim()) writeItem(buffer);
});

function writeItem(line) {
  const raw = JSON.parse(line);
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

const [code] = await once(child, "close");
if (outFile) output.end();
process.exitCode = code ?? 1;
