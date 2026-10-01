import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { z } from "zod";
import { presenterReaderSource } from "./presenter-reader-source.js";
import type { YoutubeQueueScheduler } from "./youtube-queue-scheduler.js";

const frameSchema = z.object({
  type: z.literal("hasacool"),
  version: z.literal(1),
  action: z.enum(["play", "pause", "next", "start-pippalot", "pause-tv-off"]),
  at: z.number().int().nonnegative().safe(),
}).strict();
const MAX_FRAME = 256;
const FRESH_MS = 2_000;
const DEBOUNCE_MS = 300;
// Local SSH exit does not prove remote EOF. Wait out Python's 10s lease,
// including on startup when a previous backend process may have left a reader.
const LEASE_WAIT_MS = 12_000;

type SpawnReader = (args: string[]) => ChildProcessWithoutNullStreams;
const spawnReader: SpawnReader = (args) => spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"] });

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export class PresenterInput {
  private enabled = false;
  private child: ChildProcessWithoutNullStreams | null = null;
  private reconnect: NodeJS.Timeout | null = null;
  private retire: (() => void) | null = null;
  private closed: Promise<void> = Promise.resolve();

  constructor(
    private readonly sshTarget: string,
    private readonly scheduler: YoutubeQueueScheduler,
    private readonly spawn: SpawnReader = spawnReader,
  ) {}

  start(): void {
    if (this.enabled || this.child) return;
    this.enabled = true;
    this.retry();
  }

  async stop(): Promise<void> {
    this.enabled = false;
    if (this.reconnect) clearTimeout(this.reconnect);
    this.reconnect = null;
    this.retire?.();
    await this.closed;
  }

  private retry(): void {
    if (!this.enabled) return;
    this.reconnect = setTimeout(() => {
      this.reconnect = null;
      this.connect();
    }, LEASE_WAIT_MS);
  }

  private connect(): void {
    if (!this.enabled || this.child) return;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawn([
        "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
        "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2",
        this.sshTarget, `python3 -u -c ${shellEscape(presenterReaderSource)}`,
      ]);
    } catch {
      console.warn("Presenter SSH reader could not start; retrying.");
      this.retry();
      return;
    }
    this.child = child;
    let accepting = true;
    const lifetime = new AbortController();
    let buffered = "";
    let oversized = false;
    let pending = 0;
    let offPending = false;
    const lastAction = new Map<string, number>();
    let terminate: NodeJS.Timeout | null = null;
    let kill: NodeJS.Timeout | null = null;
    let resolveClosed: () => void = () => undefined;
    this.closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
    const heartbeat = setInterval(() => {
      if (accepting && child.stdin.writable) child.stdin.write(".\n");
    }, 1_000);
    const retire = () => {
      if (!accepting) return;
      accepting = false;
      lifetime.abort();
      buffered = "";
      clearInterval(heartbeat);
      child.stdin.end();
      // EOF ends Python normally. Signals bound local SSH shutdown if it is stuck.
      terminate = setTimeout(() => child.kill("SIGTERM"), 1_000);
      kill = setTimeout(() => child.kill("SIGKILL"), 3_000);
    };
    this.retire = retire;
    const fresh = (at: number) => Math.abs(Date.now() - at) <= FRESH_MS;
    const line = (text: string) => {
      if (!accepting || !this.enabled || lifetime.signal.aborted) return;
      let value: unknown;
      try { value = JSON.parse(text); } catch { return; }
      const parsed = frameSchema.safeParse(value);
      if (!parsed.success || !fresh(parsed.data.at)) return;
      const { action, at } = parsed.data;
      const now = Date.now();
      if (now - (lastAction.get(action) ?? -Infinity) < DEBOUNCE_MS) return;
      // Reserve one coalesced Off slot independently of ordinary saturation:
      // a valid Windows press must still cancel preparations immediately.
      const off = action === "pause-tv-off";
      if (off && offPending) {
        lastAction.set(action, now);
        this.scheduler.cancelPresenterPreparation(() => accepting && this.enabled && fresh(at), lifetime.signal);
        return;
      }
      if (!off && pending >= 16) return;
      lastAction.set(action, now);
      if (off) offPending = true;
      else pending += 1;
      // Check again inside scheduler ordering: queued presses expire on disconnect/stop.
      void this.scheduler.control(action, () => accepting && this.enabled && fresh(at), lifetime.signal)
        .catch(() => console.warn("Presenter playback control failed."))
        .finally(() => {
          if (off) offPending = false;
          else pending -= 1;
        });
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (!accepting) return;
      // Character-wise framing bounds memory even for a stream without newlines.
      for (const character of chunk) {
        if (character === "\n") {
          if (!oversized) line(buffered);
          buffered = "";
          oversized = false;
        } else if (!oversized) {
          if (buffered.length >= MAX_FRAME) {
            buffered = "";
            oversized = true;
          } else buffered += character;
        }
      }
    });
    child.stderr.resume(); // Drain diagnostics without retaining unbounded SSH output.
    child.stdin.on("error", retire);
    child.stdout.on("end", retire);
    child.on("error", retire);
    child.on("close", () => {
      accepting = false;
      lifetime.abort();
      clearInterval(heartbeat);
      if (terminate) clearTimeout(terminate);
      if (kill) clearTimeout(kill);
      this.child = null;
      this.retire = null;
      resolveClosed();
      if (this.enabled) console.warn("Presenter SSH reader disconnected; retrying.");
      this.retry();
    });
  }
}
