import { randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DraftShow, LibraryState, MediaAsset } from "../../../shared/show-schema.js";
import { RASP_ACTIVE_ROOT } from "../config.js";
import type { DataRootPaths } from "./data-root.js";
import { hashDraftShow } from "./show-state-store.js";

export type BuiltBundle = {
  applyId: string;
  applyDir: string;
  mediaDir: string;
  playlistPath: string;
  launchScriptPath: string;
  runScriptPath: string;
  draftHash: string;
};

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function fileNameFor(index: number, media: MediaAsset): string {
  const prefix = String(index + 1).padStart(3, "0");
  return `${prefix}-${media.id}${media.extension}`;
}

export class PlaylistBundleService {
  constructor(private readonly paths: DataRootPaths) {}

  async build(draft: DraftShow, library: LibraryState): Promise<BuiltBundle> {
    const applyId = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const applyDir = path.join(this.paths.bundlesDir, applyId);
    const mediaDir = path.join(applyDir, "media");
    const playlistPath = path.join(applyDir, "playlist.txt");
    const runScriptPath = path.join(applyDir, "run-show.sh");
    const launchScriptPath = path.join(applyDir, "launch-player.sh");
    const draftHash = hashDraftShow(draft);

    await mkdir(mediaDir, { recursive: true });

    const playlistLines: string[] = [];
    for (const [index, item] of draft.playlist.entries()) {
      const media = library.items.find((candidate) => candidate.id === item.sourceMediaId);
      if (!media) {
        throw new Error(`Unknown media id: ${item.sourceMediaId}`);
      }
      const fileName = fileNameFor(index, media);
      const targetPath = path.join(mediaDir, fileName);
      await copyFile(media.sourcePath, targetPath);
      const repeats = media.kind === "video" ? draft.settings.videoLoopCount : 1;
      for (let repeatIndex = 0; repeatIndex < repeats; repeatIndex += 1) {
        playlistLines.push(path.posix.join("media", fileName));
      }
    }

    await writeFile(playlistPath, `${playlistLines.join("\n")}\n`, "utf8");

    const launchScript = `#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
PLAYER_ROOT=${shellEscape(RASP_ACTIVE_ROOT)}
PID_FILE="$PLAYER_ROOT/player.pid"
LOG_FILE="$PLAYER_ROOT/player.log"
PLAYLIST_FILE="$ROOT_DIR/playlist.txt"
IMAGE_DURATION=${shellEscape(String(draft.settings.imageDurationSeconds))}
mkdir -p "$PLAYER_ROOT"
rm -f "$LOG_FILE" "$PID_FILE"
touch "$LOG_FILE"
exec openvt -f -s -w -c 1 -- mpv --fs --no-terminal --really-quiet --audio=no --vo=gpu --gpu-context=drm --loop-playlist=inf --image-display-duration="$IMAGE_DURATION" --playlist="$PLAYLIST_FILE" >> "$LOG_FILE" 2>&1
`;

    const script = `#!/usr/bin/env bash
set -euo pipefail
PLAYER_ROOT=${shellEscape(RASP_ACTIVE_ROOT)}
LOG_FILE="$PLAYER_ROOT/player.log"
ACTIVE_RELEASE=${shellEscape(applyId)}
PLAYER_SERVICE=show-player.service
status() {
  local state pid
  state=$(systemctl is-active "$PLAYER_SERVICE" 2>/dev/null || true)
  pid=$(systemctl show "$PLAYER_SERVICE" --property MainPID --value 2>/dev/null || true)
  case "$state" in
    active) echo "state=running release=$ACTIVE_RELEASE pid=$pid log=$LOG_FILE" ;;
    failed) echo "state=error release=$ACTIVE_RELEASE pid= log=$LOG_FILE" ;;
    *) echo "state=stopped release=$ACTIVE_RELEASE pid= log=$LOG_FILE" ;;
  esac
}
stop() {
  sudo systemctl stop "$PLAYER_SERVICE"
  echo "stopped"
}
start() {
  sudo systemctl start "$PLAYER_SERVICE"
  sleep 2
  status
}
restart() {
  sudo systemctl restart "$PLAYER_SERVICE"
  sleep 2
  status
}
case "\${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) restart ;;
  status) status ;;
  *) echo "unknown command" >&2; exit 1 ;;
esac
`;

    await writeFile(launchScriptPath, launchScript, "utf8");
    await chmod(launchScriptPath, 0o755);
    await writeFile(runScriptPath, script, "utf8");
    await chmod(runScriptPath, 0o755);

    return { applyId, applyDir, mediaDir, playlistPath, launchScriptPath, runScriptPath, draftHash };
  }
}
