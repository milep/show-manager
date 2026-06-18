import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  defaultDraftShow,
  draftShowSchema,
  lastAppliedSchema,
  libraryStateSchema,
  type DraftShow,
  type LastApplied,
  type LibraryState,
} from "../../../shared/show-schema.js";
import type { DataRootPaths } from "./data-root.js";

const emptyLibrary: LibraryState = { items: [] };

async function readJson<T>(filePath: string, fallback: T, parse: (value: unknown) => T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writePrettyJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function hashDraftShow(draft: DraftShow): string {
  return createHash("sha256").update(JSON.stringify(draft)).digest("hex").slice(0, 16);
}

export class ShowStateStore {
  constructor(private readonly paths: DataRootPaths) {}

  async getDraftShow(): Promise<DraftShow> {
    return readJson(this.paths.showFile, defaultDraftShow, (value) => draftShowSchema.parse(value));
  }

  async saveDraftShow(draft: DraftShow): Promise<DraftShow> {
    const parsed = draftShowSchema.parse(draft);
    await writePrettyJson(this.paths.showFile, parsed);
    return parsed;
  }

  async getLibrary(): Promise<LibraryState> {
    return readJson(this.paths.libraryFile, emptyLibrary, (value) => libraryStateSchema.parse(value));
  }

  async saveLibrary(library: LibraryState): Promise<LibraryState> {
    const parsed = libraryStateSchema.parse(library);
    parsed.items.sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
    await writePrettyJson(this.paths.libraryFile, parsed);
    return parsed;
  }

  async addLibraryItem(item: LibraryState["items"][number]): Promise<LibraryState> {
    const library = await this.getLibrary();
    const nextLibrary = { items: [item, ...library.items.filter((candidate) => candidate.id !== item.id)] };
    return this.saveLibrary(nextLibrary);
  }

  async getLastApplied(): Promise<LastApplied | null> {
    return readJson(this.paths.lastAppliedFile, null, (value) => (value === null ? null : lastAppliedSchema.parse(value)));
  }

  async saveLastApplied(lastApplied: LastApplied): Promise<LastApplied> {
    const parsed = lastAppliedSchema.parse(lastApplied);
    await writePrettyJson(this.paths.lastAppliedFile, parsed);
    return parsed;
  }
}
