#!/usr/bin/env node
import Database from "better-sqlite3";
import { cleanupYoutubeTitles, youtubeTitleCleanupBatchSchema } from "../dist/server/src/services/youtube-title-cleanup.js";

function usage() {
  console.error("Usage: node scripts/youtube-cleanup-titles.mjs --db /path/youtube.sqlite [--limit 1..100] [--refresh VIDEO_ID]... (build server first; default batch 25)");
}
const args = process.argv.slice(2);
let dbFile;
let limit;
const refreshVideoIds = [];
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (!value) { usage(); process.exit(1); }
  if (flag === "--db" && !dbFile) dbFile = value;
  else if (flag === "--limit" && limit === undefined) limit = Number(value);
  else if (flag === "--refresh") refreshVideoIds.push(value);
  else { usage(); process.exit(1); }
}
const parsed = youtubeTitleCleanupBatchSchema.safeParse({ ...(limit === undefined ? {} : { limit }), refreshVideoIds });
if (!dbFile || !parsed.success) { usage(); process.exit(1); }
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
let db;
try {
  db = new Database(dbFile, { fileMustExist: true });
  const summary = await cleanupYoutubeTitles(db, {
    ...parsed.data, signal: controller.signal,
    onProgress: (progress) => console.log(JSON.stringify({ event: "progress", ...progress })),
  });
  console.log(JSON.stringify({ event: "summary", ...summary }));
  if (summary.interrupted) process.exitCode = 130;
} catch {
  // Never put metadata/provider payloads or credentials in command output.
  console.error("Title cleanup failed. Check the database path and schema.");
  process.exitCode = 1;
} finally {
  db?.close();
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
