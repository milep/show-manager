import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DraftShow, LastApplied, LibraryState, RemoteStatus } from "../shared/show-schema";
import { defaultDraftShow } from "../shared/show-schema";
import type { ShowManagerConfig } from "../server/src/config";
import { ensureDataRoot, type DataRootPaths } from "../server/src/services/data-root";
import { ShowStateStore } from "../server/src/services/show-state-store";

export async function makeTempPaths(): Promise<DataRootPaths> {
  const root = await mkdtemp(path.join(os.tmpdir(), "show-manager-"));
  return ensureDataRoot(root);
}

export function makeConfig(root: string): ShowManagerConfig {
  return {
    host: "127.0.0.1",
    port: 4791,
    dataRoot: root,
    raspSshTarget: "rasp",
    publicBaseUrl: "https://show.example.invalid",
    youtubeDataApiKey: null,
  };
}

export async function seedLibrary(paths: DataRootPaths, store: ShowStateStore): Promise<LibraryState> {
  const uploadDir = path.join(paths.uploadsDir, "media-1");
  await mkdir(uploadDir, { recursive: true });
  const sourcePath = path.join(uploadDir, "source.jpg");
  const thumbnailPath = path.join(uploadDir, "thumb.jpg");
  await writeFile(sourcePath, "img");
  await writeFile(thumbnailPath, "thumb");
  const library: LibraryState = {
    items: [
      {
        id: "media-1",
        kind: "image",
        originalFilename: "sample.jpg",
        extension: ".jpg",
        mimeType: "image/jpeg",
        uploadedAt: new Date().toISOString(),
        sourcePath,
        thumbnailPath,
        thumbnailUrl: "/media/media-1/thumb.jpg",
        durationSeconds: null,
        width: 640,
        height: 480,
      },
    ],
  };
  await store.saveLibrary(library);
  return library;
}

export function makeRemoteStatus(overrides: Partial<RemoteStatus> = {}): RemoteStatus {
  return {
    state: "stopped",
    activeReleaseId: null,
    pid: null,
    logPath: "/home/pi/show-player/player.log",
    checkedAt: new Date().toISOString(),
    detail: null,
    ...overrides,
  };
}

export function makeLastApplied(overrides: Partial<LastApplied> = {}): LastApplied {
  return {
    applyId: "apply-1",
    draftHash: "draft-hash",
    appliedAt: new Date().toISOString(),
    remoteStatus: makeRemoteStatus({ state: "running", activeReleaseId: "apply-1", pid: 1234 }),
    stderr: null,
    ...overrides,
  };
}

export function makeDraft(overrides: Partial<DraftShow> = {}): DraftShow {
  return {
    ...defaultDraftShow,
    ...overrides,
  };
}
