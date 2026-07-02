import type { YoutubePlaybackStatus } from "../../../shared/show-schema.js";
import { YOUTUBE_TV_PACKAGE, type ShowManagerConfig } from "../config.js";
import { runCommand, type CommandRunner } from "./run-command.js";

const MEDIA_STATE_NONE = 0;
const MEDIA_STATE_STOPPED = 1;
const MEDIA_STATE_PAUSED = 2;
const MEDIA_STATE_PLAYING = 3;
const MEDIA_STATE_BUFFERING = 6;
const MEDIA_STATE_ERROR = 7;

function nowStatus(overrides: Partial<YoutubePlaybackStatus>): YoutubePlaybackStatus {
  return {
    connected: false,
    state: "unknown",
    packageName: null,
    videoId: null,
    title: null,
    subtitle: null,
    album: null,
    positionMs: null,
    durationMs: null,
    checkedAt: new Date().toISOString(),
    detail: null,
    ...overrides,
  };
}

function stateName(stateCode: number): YoutubePlaybackStatus["state"] {
  if (stateCode === MEDIA_STATE_PAUSED) return "paused";
  if (stateCode === MEDIA_STATE_PLAYING) return "playing";
  if (stateCode === MEDIA_STATE_BUFFERING) return "buffering";
  if (stateCode === MEDIA_STATE_ERROR) return "error";
  if (stateCode === MEDIA_STATE_NONE || stateCode === MEDIA_STATE_STOPPED) return "idle";
  return "unknown";
}

function parseDescription(line: string): { title: string | null; subtitle: string | null; album: string | null } {
  const marker = "description=";
  const index = line.indexOf(marker);
  if (index === -1) {
    return { title: null, subtitle: null, album: null };
  }
  const description = line.slice(index + marker.length).trim();
  const parts = description.split(", ").map((part) => part.trim()).map((part) => (part === "null" ? "" : part));
  return {
    title: parts[0] || null,
    subtitle: parts[1] || null,
    album: parts[2] || null,
  };
}

function parseVideoId(output: string): string | null {
  const match = output.match(/(?:watch\?v=|youtu\.be\/|vi\/)([A-Za-z0-9_-]{11})/);
  return match?.[1] ?? null;
}

export function parseYoutubePlaybackStatus(output: string): YoutubePlaybackStatus {
  const lines = output.split(/\r?\n/);
  const packageIndex = lines.findIndex((line) => line.includes(`package=${YOUTUBE_TV_PACKAGE}`));
  if (packageIndex === -1) {
    return nowStatus({ connected: true, state: "idle", detail: "YouTube TV media session not found." });
  }

  const block = lines.slice(packageIndex, packageIndex + 30);
  const stateLine = block.find((line) => line.includes("PlaybackState"));
  const metadataLine = block.find((line) => line.includes("metadata:"));
  const stateMatch = stateLine?.match(/state=(\d+)/);
  const positionMatch = stateLine?.match(/position=(\d+)/);
  const stateCode = stateMatch ? Number(stateMatch[1]) : null;
  const description = metadataLine ? parseDescription(metadataLine) : { title: null, subtitle: null, album: null };

  return nowStatus({
    connected: true,
    state: stateCode === null ? "unknown" : stateName(stateCode),
    packageName: YOUTUBE_TV_PACKAGE,
    videoId: parseVideoId(output),
    title: description.title,
    subtitle: description.subtitle,
    album: description.album,
    positionMs: positionMatch ? Number(positionMatch[1]) : null,
    durationMs: null,
    detail: stateLine?.trim() ?? null,
  });
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export class AdbYoutubeController {
  constructor(
    private readonly config: ShowManagerConfig,
    private readonly run: CommandRunner = runCommand,
  ) {}

  private runRemoteAdb(args: string[]) {
    const command = ["adb", ...args.map(shellEscape)].join(" ");
    return this.run("ssh", [this.config.raspSshTarget, command]);
  }

  async connect(): Promise<void> {
    await this.runRemoteAdb(["connect", this.config.adbTvTarget]);
  }

  async getPlaybackStatus(): Promise<YoutubePlaybackStatus> {
    try {
      await this.connect();
      const result = await this.runRemoteAdb(["shell", "dumpsys", "media_session"]);
      return parseYoutubePlaybackStatus(result.stdout);
    } catch (error) {
      return nowStatus({
        connected: false,
        state: "error",
        detail: error instanceof Error ? error.message : "ADB status failed.",
      });
    }
  }

  async playVideo(videoId: string): Promise<void> {
    await this.connect();
    await this.runRemoteAdb([
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
  }

  async pause(): Promise<void> {
    await this.connect();
    await this.runRemoteAdb(["shell", "input", "keyevent", "KEYCODE_MEDIA_PAUSE"]);
  }

  async play(): Promise<void> {
    await this.connect();
    await this.runRemoteAdb(["shell", "input", "keyevent", "KEYCODE_MEDIA_PLAY"]);
  }
}
