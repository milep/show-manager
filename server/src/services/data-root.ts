import { mkdir } from "node:fs/promises";
import path from "node:path";

export type DataRootPaths = {
  root: string;
  uploadsDir: string;
  stateDir: string;
  runtimeDir: string;
  bundlesDir: string;
  showFile: string;
  libraryFile: string;
  lastAppliedFile: string;
  applyHistoryFile: string;
  authStateFile: string;
  youtubeDbFile: string;
  qrImageFile: string;
};

export function getDataRootPaths(root: string): DataRootPaths {
  const uploadsDir = path.join(root, "uploads");
  const stateDir = path.join(root, "state");
  const runtimeDir = path.join(root, "runtime");
  return {
    root,
    uploadsDir,
    stateDir,
    runtimeDir,
    bundlesDir: path.join(runtimeDir, "bundles"),
    showFile: path.join(stateDir, "show.json"),
    libraryFile: path.join(stateDir, "library.json"),
    lastAppliedFile: path.join(runtimeDir, "last-applied.json"),
    applyHistoryFile: path.join(runtimeDir, "apply-history.jsonl"),
    authStateFile: path.join(stateDir, "auth.json"),
    youtubeDbFile: path.join(stateDir, "youtube.sqlite"),
    qrImageFile: path.join(runtimeDir, "qr-login.gif"),
  };
}

export async function ensureDataRoot(root: string): Promise<DataRootPaths> {
  const paths = getDataRootPaths(root);
  await Promise.all([
    mkdir(paths.uploadsDir, { recursive: true }),
    mkdir(paths.stateDir, { recursive: true }),
    mkdir(paths.runtimeDir, { recursive: true }),
    mkdir(paths.bundlesDir, { recursive: true }),
  ]);
  return paths;
}
