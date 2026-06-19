#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

function usage() {
  console.error(`Usage: ${basename(process.argv[1])} <jsonl-file> [--url http://127.0.0.1:4791]`);
}

const args = process.argv.slice(2);
const file = args.shift();
if (!file || file.startsWith("--")) {
  usage();
  process.exit(1);
}

let baseUrl = "http://127.0.0.1:4791";
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const value = args[index + 1];
  if (arg === "--url" && value) {
    baseUrl = value;
    index += 1;
  } else {
    usage();
    process.exit(1);
  }
}

const lines = (await readFile(file, "utf8")).split("\n").map((line) => line.trim()).filter(Boolean);
const items = [];
let invalid = 0;
for (const line of lines) {
  try {
    items.push(JSON.parse(line));
  } catch {
    invalid += 1;
  }
}

const totals = { imported: 0, skippedExisting: 0, invalid };
const batchSize = 500;
for (let index = 0; index < items.length; index += batchSize) {
  const batch = items.slice(index, index + batchSize);
  const response = await fetch(new URL("/api/youtube/confirmed-videos/import", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: batch }),
  });
  const body = await response.json();
  if (!response.ok) {
    console.error(body);
    process.exit(1);
  }
  totals.imported += body.imported;
  totals.skippedExisting += body.skippedExisting;
  totals.invalid += body.invalid;
}
console.log(JSON.stringify(totals, null, 2));
