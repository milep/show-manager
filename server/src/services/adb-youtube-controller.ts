import type { YoutubePlaybackStatus } from "../../../shared/show-schema.js";
import { YOUTUBE_TV_PACKAGE, type ShowManagerConfig } from "../config.js";
import { runCommand, type CommandRunner } from "./run-command.js";

const PREPARE_MS = 30_000;
const SLEEP_VERIFY_MS = 10_000;
const POLL_MS = 500;
// Conservative quarantine after local failure, not remote exit proof: allow
// 5s late startup (SSH connect budget), 5s child watchdog, 1s teardown margin.
const REMOTE_DRAIN_MS = 11_000;

// Same existing Python prerequisite as the presenter reader. Ignore remote SSH
// hangup until adb has exited; subprocess.run kills and waits on timeout.
export const boundedAdbSource = `import signal, subprocess, sys
signal.signal(signal.SIGHUP, signal.SIG_IGN)
result = subprocess.run(sys.argv[1:], capture_output=True, text=True, timeout=5)
sys.stdout.write(result.stdout)
sys.stderr.write(result.stderr)
sys.exit(result.returncode)
`;

type StableTvPowerState = "awake" | "asleep" | "dreaming";
export type TvPowerState = StableTvPowerState | "transitioning";

export function parseTvPowerState(output: string): TvPowerState {
  const states = [...output.matchAll(/^\s*mWakefulness=(\w+)\s*$/gm)].map((match) => match[1]);
  const changing = [...output.matchAll(/^\s*mWakefulnessChanging=(.*)$/gm)].map((match) => match[1]?.trim());
  const state = states[0];
  if (states.length !== 1 || !["Awake", "Asleep", "Dreaming", "Dozing"].includes(state ?? "")
      || changing.length > 1 || (changing.length === 1 && changing[0] !== "true" && changing[0] !== "false")) {
    throw new Error("TV power state is unknown.");
  }
  // Older dumps omit the flag. A reported transition, including Dozing, is
  // never permission to wake/sleep or evidence of an already-off TV.
  if (state === "Dozing" || changing[0] === "true") return "transitioning";
  if (state === "Awake") return "awake";
  if (state === "Asleep") return "asleep";
  return "dreaming";
}

export function nativeYoutubeForeground(window: string, activity: string): boolean {
  const pkg = "com\\.google\\.android\\.youtube\\.tv/";
  return new RegExp(`mCurrentFocus=.*\\b${pkg}`).test(window)
    && new RegExp(`(?:mResumedActivity|topResumedActivity)[:=].*\\b${pkg}`).test(activity);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function bounded<T>(ms: number, parent: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("TV operation cancelled."));
  if (parent?.aborted) cancel();
  parent?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("TV readiness deadline exceeded.")), ms);
  try {
    controller.signal.throwIfAborted();
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
  }
}

const MEDIA_STATE_NONE = 0;
const MEDIA_STATE_STOPPED = 1;
const MEDIA_STATE_PAUSED = 2;
const MEDIA_STATE_PLAYING = 3;
const MEDIA_STATE_BUFFERING = 6;
const MEDIA_STATE_ERROR = 7;
const SYMBOLIC_MEDIA_STATES: Readonly<Record<string, number>> = {
  NONE: MEDIA_STATE_NONE,
  STOPPED: MEDIA_STATE_STOPPED,
  PAUSED: MEDIA_STATE_PAUSED,
  PLAYING: MEDIA_STATE_PLAYING,
  BUFFERING: MEDIA_STATE_BUFFERING,
  ERROR: MEDIA_STATE_ERROR,
};

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
  const stateMatch = stateLine?.match(/PlaybackState\s*\{\s*state=(?:(\d+)|([A-Z_]+)\((\d+)\))(?=\s*[,}])/);
  const positionMatch = stateLine?.match(/position=(\d+)/);
  let stateCode = stateMatch ? Number(stateMatch[1] ?? stateMatch[3]) : null;
  if (stateMatch?.[2] && SYMBOLIC_MEDIA_STATES[stateMatch[2]] !== stateCode) stateCode = null;
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

  private async runRemoteAdb(args: string[], signal?: AbortSignal) {
    signal?.throwIfAborted();
    const targeted = args[0] === "shell" ? ["-s", this.config.adbTvTarget, ...args] : args;
    // The Pi watchdog also tears down adb if killing local SSH loses remote EOF.
    const command = ["python3 -c", shellEscape(boundedAdbSource), "adb", ...targeted.map(shellEscape)].join(" ");
    try {
      const result = await this.run("ssh", [
        "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", this.config.raspSshTarget, command,
      ], { signal, timeoutMs: 12_000 });
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      // Timeout/transport loss can leave the hangup-resistant wrapper alive
      // without aborting the signal. Quarantine every runner rejection; neither
      // an exit code nor a closed local SSH process proves remote termination.
      await wait(REMOTE_DRAIN_MS);
      throw error;
    }
  }

  async connect(signal?: AbortSignal): Promise<void> {
    await this.runRemoteAdb(["connect", this.config.adbTvTarget], signal);
  }

  async getPowerState(parent?: AbortSignal): Promise<StableTvPowerState> {
    return bounded(SLEEP_VERIFY_MS, parent, async (signal) => {
      await this.connect(signal);
      return this.waitForStablePower(signal, SLEEP_VERIFY_MS / POLL_MS);
    });
  }

  private async waitForStablePower(signal: AbortSignal, maxPolls: number): Promise<StableTvPowerState> {
    for (let poll = 0; poll < maxPolls; poll += 1) {
      const power = await this.readPowerState(signal);
      if (power !== "transitioning") return power;
      await wait(POLL_MS, signal);
    }
    throw new Error("TV power did not become stable.");
  }

  private async readPowerState(signal?: AbortSignal): Promise<TvPowerState> {
    const result = await this.runRemoteAdb(["shell", "dumpsys", "power"], signal);
    return parseTvPowerState(result.stdout);
  }

  async prepareYoutube(parent?: AbortSignal): Promise<void> {
    return bounded(PREPARE_MS, parent, async (signal) => {
      await this.connect(signal);
      const power = await this.waitForStablePower(signal, PREPARE_MS / POLL_MS);
      if (power === "asleep" || power === "dreaming") {
        await this.runRemoteAdb(["shell", "input", "keyevent", "KEYCODE_WAKEUP"], signal);
      }
      let launched = false;
      for (let poll = 0; poll < PREPARE_MS / POLL_MS; poll += 1) {
        signal.throwIfAborted();
        if (await this.readPowerState(signal) === "awake") {
          const boot = await this.runRemoteAdb(["shell", "getprop", "sys.boot_completed"], signal);
          if (boot.stdout.trim() === "1") {
            if (!launched) {
              const result = await this.runRemoteAdb([
                "shell", "am", "start", "-a", "android.intent.action.MAIN",
                "-c", "android.intent.category.LEANBACK_LAUNCHER", "-p", YOUTUBE_TV_PACKAGE,
              ], signal);
              if (/Error:|Exception|unable to resolve/i.test(result.stdout + result.stderr)) {
                throw new Error("Native YouTube app launch failed.");
              }
              launched = true;
            }
            // TCL omits mCurrentFocus from the windows dump; displays includes it.
            const window = await this.runRemoteAdb(["shell", "dumpsys", "window", "displays"], signal);
            const activity = await this.runRemoteAdb(["shell", "dumpsys", "activity", "activities"], signal);
            if (nativeYoutubeForeground(window.stdout, activity.stdout)) return;
          }
        }
        await wait(POLL_MS, signal);
      }
      throw new Error("Native YouTube did not become ready.");
    });
  }

  async sleepAndVerify(parent?: AbortSignal): Promise<void> {
    return bounded(SLEEP_VERIFY_MS, parent, async (signal) => {
      await this.connect(signal);
      if (await this.waitForStablePower(signal, SLEEP_VERIFY_MS / POLL_MS) === "asleep") return;
      await this.runRemoteAdb(["shell", "input", "keyevent", "KEYCODE_SLEEP"], signal);
      for (let poll = 0; poll < SLEEP_VERIFY_MS / POLL_MS; poll += 1) {
        if (await this.readPowerState(signal) === "asleep") return;
        await wait(POLL_MS, signal);
      }
      throw new Error("TV did not report asleep.");
    });
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

  async togglePower(): Promise<void> {
    await this.connect();
    await this.runRemoteAdb(["shell", "input", "keyevent", "KEYCODE_POWER"]);
  }

  async pause(signal?: AbortSignal): Promise<void> {
    await this.connect(signal);
    await this.runRemoteAdb(["shell", "input", "keyevent", "KEYCODE_MEDIA_PAUSE"], signal);
  }

  async play(): Promise<void> {
    await this.connect();
    await this.runRemoteAdb(["shell", "input", "keyevent", "KEYCODE_MEDIA_PLAY"]);
  }
}
