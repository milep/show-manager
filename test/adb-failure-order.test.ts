import { readFile, rm } from "node:fs/promises";
import { setTimeout as realDelay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdbYoutubeController, boundedAdbSource } from "../server/src/services/adb-youtube-controller";
import { runCommand, type CommandRunner } from "../server/src/services/run-command";
import { YoutubeQueueScheduler } from "../server/src/services/youtube-queue-scheduler";
import { YoutubeStore } from "../server/src/services/youtube-store";
import { makeConfig, makeTempPaths } from "./test-helpers";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
async function readPid(file: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const pid = Number(await readFile(file, "utf8"));
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch { /* The isolated fixture may not have written its PID yet. */ }
    await realDelay(20);
  }
  throw new Error(`Fixture PID did not arrive: ${file}`);
}
function alive(pid: number): boolean {
  if (pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function storeFixture() {
  const paths = await makeTempPaths();
  const store = new YoutubeStore(paths);
  store.addToQueue({ sourceId: "Tb0MC0jFv6M", url: "https://youtu.be/Tb0MC0jFv6M" });
  store.markPlaying(store.firstPending()!.id); store.setAutomationPaused(true);
  return { paths, store, before: store.getQueue() };
}

describe("ambiguous local ADB transport failures preserve scheduler ordering", () => {
  it.each([
    ["timeout", "off"], ["timeout", "toggle"], ["transport", "off"], ["transport", "toggle"],
  ] as const)("unaborted %s blocks subsequent %s through the late-start/watchdog guard", async (failure, followup) => {
    const f = await storeFixture();
    vi.useFakeTimers();
    const calls: string[] = [];
    const events: string[] = [];
    let failedSignal: AbortSignal | undefined;
    let remoteActive = false;
    let power = "Awake";
    const run: CommandRunner = vi.fn(async (_command, args, options) => {
      const command = args.at(-1)!; calls.push(command);
      if (calls.length === 1) {
        failedSignal = options!.signal;
        await new Promise<void>((_resolve, reject) => {
          setTimeout(() => {
            expect(failedSignal!.aborted).toBe(false);
            events.push("local-closed");
            // Synthetic hangup-resistant wrapper starts late and owns its child
            // for the full watchdog budget; rejecting SSH does not kill it.
            setTimeout(() => {
              remoteActive = true; events.push("remote-started");
              setTimeout(() => { remoteActive = false; events.push("remote-closed"); }, 5000);
            }, 5000);
            reject(new Error(failure === "timeout" ? "ssh timed out." : "ssh exited with 255. transport lost"));
          }, options!.timeoutMs);
        });
      }
      expect(remoteActive).toBe(false);
      if (command.includes("KEYCODE_SLEEP")) power = "Asleep";
      return { stdout: command.includes("'power'") ? `mWakefulness=${power}\n` : "", stderr: "" };
    });
    const controller = new AdbYoutubeController(makeConfig(f.paths.root), run);
    const scheduler = new YoutubeQueueScheduler(f.store, controller);
    const load = vi.spyOn(f.store, "loadPippalotToQueue");
    try {
      const rejected = expect(scheduler.control("start-pippalot")).rejects.toThrow(failure === "timeout" ? "timed out" : "transport lost");
      await vi.advanceTimersByTimeAsync(12_000);
      expect(failedSignal!.aborted).toBe(false); expect(events).toEqual(["local-closed"]);
      const following = followup === "off" ? scheduler.control("pause-tv-off") : scheduler.togglePower();
      await vi.advanceTimersByTimeAsync(6000);
      expect(remoteActive).toBe(true); expect(calls).toHaveLength(1);
      expect(f.store.getQueue()).toEqual(f.before); expect(load).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(4999);
      expect(events).toEqual(["local-closed", "remote-started", "remote-closed"]);
      expect(calls).toHaveLength(1); // Local/remote close is not an early-release claim.
      await vi.advanceTimersByTimeAsync(1);
      await Promise.all([rejected, following]);
      expect(calls.some((command) => command.includes(followup === "off" ? "KEYCODE_SLEEP" : "KEYCODE_POWER"))).toBe(true);
      expect(f.store.getQueue()).toEqual(f.before); expect(load).not.toHaveBeenCalled();
      if (followup === "off") expect(f.store.isAutomationPaused()).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      const stopped = scheduler.stop(); await vi.advanceTimersByTimeAsync(30_000); await stopped;
      f.store.close(); await rm(f.paths.root, { recursive: true, force: true });
    }
  });

  it("transport loss leaves a real late-started watchdog child alive; toggle waits for the conservative guard", async () => {
    const f = await storeFixture();
    const wrapperFile = `${f.paths.root}/late-wrapper.pid`;
    const childFile = `${f.paths.root}/surviving-child.pid`;
    vi.useFakeTimers();
    let wrapperPid = 0;
    let childPid = 0;
    let failedSignal: AbortSignal | undefined;
    let reportFailure = () => {};
    const failed = new Promise<void>((resolve) => { reportFailure = resolve; });
    let remoteOutcome: Promise<unknown> | undefined;
    const calls: string[] = [];
    const run: CommandRunner = vi.fn(async (_command, args, options) => {
      calls.push(args.at(-1)!);
      if (calls.length === 1) {
        failedSignal = options!.signal;
        // Exact shipped watchdog, delayed startup, local synthetic child only.
        // The fixture's SSH rejection is independent of the surviving wrapper.
        remoteOutcome = runCommand("python3", ["-c", `import os, signal, time
signal.signal(signal.SIGHUP, signal.SIG_IGN)
open(${JSON.stringify(wrapperFile)}, 'w').write(str(os.getpid()))
time.sleep(1)
${boundedAdbSource}`, process.execPath, "-e", `
require('node:fs').writeFileSync(${JSON.stringify(childFile)}, String(process.pid));
process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);
`]).catch((error: unknown) => error);
        wrapperPid = await readPid(wrapperFile);
        process.kill(wrapperPid, "SIGHUP");
        expect(failedSignal!.aborted).toBe(false);
        reportFailure();
        throw new Error("ssh exited with 255. fixture transport lost");
      }
      expect(alive(childPid)).toBe(false);
      return { stdout: "", stderr: "" };
    });
    const controller = new AdbYoutubeController(makeConfig(f.paths.root), run);
    const scheduler = new YoutubeQueueScheduler(f.store, controller);
    try {
      const rejected = expect(scheduler.control("start-pippalot")).rejects.toThrow("fixture transport lost");
      await failed; await vi.advanceTimersByTimeAsync(0);
      expect(failedSignal!.aborted).toBe(false);
      const toggle = scheduler.togglePower();
      childPid = await readPid(childFile);
      expect(alive(wrapperPid)).toBe(true); expect(alive(childPid)).toBe(true);
      await vi.advanceTimersByTimeAsync(6000);
      expect(calls).toHaveLength(1); expect(alive(childPid)).toBe(true);
      // Real elapsed-time watchdog kills/reaps its child, not a Promise race.
      const outcome = await remoteOutcome;
      expect(outcome).toBeInstanceOf(Error); expect(String(outcome)).toContain("TimeoutExpired");
      expect(alive(childPid)).toBe(false); expect(alive(wrapperPid)).toBe(false);
      await vi.advanceTimersByTimeAsync(4999);
      expect(calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      await Promise.all([rejected, toggle]);
      expect(calls.at(-1)).toContain("KEYCODE_POWER");
      expect(f.store.getQueue()).toEqual(f.before);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      // Always reap the actual local fixture before deleting its synthetic root.
      if (childPid && alive(childPid)) process.kill(childPid, "SIGKILL");
      await remoteOutcome;
      const stopped = scheduler.stop(); await vi.advanceTimersByTimeAsync(30_000); await stopped;
      f.store.close(); await rm(f.paths.root, { recursive: true, force: true });
    }
  }, 20_000);
});
