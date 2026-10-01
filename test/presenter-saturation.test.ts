import Database from "better-sqlite3";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdbYoutubeController } from "../server/src/services/adb-youtube-controller";
import { PresenterInput } from "../server/src/services/presenter-input";
import type { CommandRunner } from "../server/src/services/run-command";
import { YoutubeQueueScheduler } from "../server/src/services/youtube-queue-scheduler";
import { YoutubeStore } from "../server/src/services/youtube-store";
import { makeConfig, makeTempPaths } from "./test-helpers";

class Reader extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough();
  kill = vi.fn(() => true);
  process(): ChildProcessWithoutNullStreams { return this as unknown as ChildProcessWithoutNullStreams; }
  close() { this.emit("close", 0); this.stdin.destroy(); this.stdout.destroy(); this.stderr.destroy(); }
}
function frame(action: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type: "hasacool", version: 1, action, at: Date.now(), ...extra }) + "\n";
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function makeCachedStore() {
  const paths = await makeTempPaths();
  const store = new YoutubeStore(paths);
  store.addToQueue({ sourceId: "Tb0MC0jFv6M", url: "https://youtu.be/Tb0MC0jFv6M" });
  store.markPlaying(store.firstPending()!.id); store.setAutomationPaused(true);
  const db = new Database(paths.youtubeDbFile);
  db.prepare("insert into youtube_playlists (id, name, created_at, updated_at) values ('pippalot', 'Pippalot', ?, ?)").run(new Date().toISOString(), new Date().toISOString());
  db.close();
  store.addToPippalot({ sourceId: "GF3wagWwHjM", url: "https://youtu.be/GF3wagWwHjM" });
  return { paths, store };
}

async function heldOffFixture(stage: "pause" | "sleep") {
  const { paths, store } = await makeCachedStore();
  store.setAutomationPaused(false);
  const before = store.getQueue();
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const calls: string[] = [];
  let power = "Awake";
  let held = false;
  let finish = () => {};
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const run: CommandRunner = vi.fn(async (_command, args) => {
    const command = args.at(-1)!; calls.push(command);
    if (command.includes("'shell'")) expect(command).toContain("'-s' 'synthetic-tv:5555'");
    if (command.includes("KEYCODE_WAKEUP")) power = "Awake";
    if (command.includes("KEYCODE_SLEEP")) power = "Asleep";
    if (command.includes(stage === "pause" ? "KEYCODE_MEDIA_PAUSE" : "KEYCODE_SLEEP")) {
      held = true; await gate;
    }
    let stdout = "";
    if (command.includes("'power'")) stdout = `mWakefulness=${power}\n`;
    if (command.includes("'getprop'")) stdout = "1";
    if (command.includes("'window'")) {
      expect(command).toContain("'dumpsys' 'window' 'displays'");
      stdout = "mCurrentFocus=Window{abc u0 com.google.android.youtube.tv/.ShellActivity}";
    }
    if (command.includes("'activities'")) stdout = "mResumedActivity: ActivityRecord{abc u0 com.google.android.youtube.tv/.ShellActivity}";
    return { stdout, stderr: "" };
  });
  const controller = new AdbYoutubeController({ ...makeConfig(paths.root), adbTvTarget: "synthetic-tv:5555" }, run);
  const prepare = vi.spyOn(controller, "prepareYoutube");
  const scheduler = new YoutubeQueueScheduler(store, controller);
  const control = vi.spyOn(scheduler, "control");
  const cancel = vi.spyOn(scheduler, "cancelPresenterPreparation");
  const load = vi.spyOn(store, "loadPippalotToQueue");
  const persist = vi.spyOn(store, "setAutomationPaused");
  const reader = new Reader();
  const input = new PresenterInput("synthetic-pi", scheduler, () => reader.process());
  input.start(); await vi.advanceTimersByTimeAsync(12_000);
  return { store, before, reader, input, scheduler, control, cancel, prepare, load, persist, calls,
    finish, isHeld: () => held,
    cleanup: async () => {
      finish(); const stopped = input.stop(); reader.close();
      const drained = scheduler.stop(); await vi.advanceTimersByTimeAsync(12_000);
      await Promise.all([stopped, drained]);
      expect(vi.getTimerCount()).toBe(0);
      store.close(); await rm(paths.root, { recursive: true, force: true });
    },
  };
}

describe("saturated presenter input with actual scheduler/controller preparation", () => {
  it("reserves one coalesced validated Off, cancels all starts before commit and eventually pauses/sleeps", async () => {
    const { paths, store } = await makeCachedStore();
    const before = store.getQueue();
    const load = vi.spyOn(store, "loadPippalotToQueue");
    const events: string[] = [];
    let power = "Asleep";
    let wakeActive = false;
    let cancelled = false;
    let finishPause = () => {};
    const pauseGate = new Promise<void>((resolve) => { finishPause = resolve; });
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const run: CommandRunner = vi.fn(async (_command, args, options) => {
      const command = args.at(-1)!;
      if (command.includes("'shell'")) expect(command).toContain("'-s' 'synthetic-tv:5555'");
      if (command.includes("KEYCODE_WAKEUP")) {
        wakeActive = true; events.push("wake-active");
        await new Promise<void>((_resolve, reject) => {
          options!.signal!.addEventListener("abort", () => {
            cancelled = true; events.push("wake-cancelled");
            setTimeout(() => {
              wakeActive = false; power = "Awake"; events.push("wake-closed");
              reject(new Error("synthetic wake child closed"));
            }, 500);
          }, { once: true });
        });
      }
      if (command.includes("KEYCODE_MEDIA_PAUSE")) {
        expect(wakeActive).toBe(false); events.push("pause-request");
        await pauseGate; events.push("pause-ack");
      }
      if (command.includes("KEYCODE_SLEEP")) {
        expect(store.isAutomationPaused()).toBe(true); events.push("sleep"); power = "Asleep";
      }
      expect(command).not.toContain("watch?v=");
      return { stdout: command.includes("'power'") ? `mWakefulness=${power}\n` : "", stderr: "" };
    });
    const controller = new AdbYoutubeController({ ...makeConfig(paths.root), adbTvTarget: "synthetic-tv:5555" }, run);
    const scheduler = new YoutubeQueueScheduler(store, controller);
    const control = vi.spyOn(scheduler, "control");
    const reader = new Reader();
    const input = new PresenterInput("synthetic-pi", scheduler, () => reader.process());
    try {
      input.start(); await vi.advanceTimersByTimeAsync(12_000);
      // Fill all 16 ordinary slots behind the first real prepareYoutube call.
      for (let count = 0; count < 16; count += 1) {
        reader.stdout.write(frame("start-pippalot")); await vi.advanceTimersByTimeAsync(301);
      }
      expect(wakeActive).toBe(true); expect(control).toHaveBeenCalledTimes(16);
      for (let count = 0; count < 20; count += 1) {
        reader.stdout.write(frame("start-pippalot")); await vi.advanceTimersByTimeAsync(301);
      }
      expect(control).toHaveBeenCalledTimes(16);
      // Otherwise valid Off frames must still pass strict schema/freshness first.
      reader.stdout.write("{malformed}\n" + "x".repeat(300) + "\n");
      for (const invalid of [{ command: "off" }, { at: Date.now() - 2001 }, { at: Date.now() + 2001 }, { version: 2 }]) {
        reader.stdout.write(frame("pause-tv-off", invalid));
      }
      expect(cancelled).toBe(false); expect(control).toHaveBeenCalledTimes(16);
      reader.stdout.write(frame("pause-tv-off"));
      expect(cancelled).toBe(true); expect(control).toHaveBeenCalledTimes(17);
      expect(store.getQueue()).toEqual(before); expect(load).not.toHaveBeenCalled();
      // Fresh repeated Windows frames outside debounce cannot grow the Off backlog.
      for (let count = 0; count < 10; count += 1) {
        reader.stdout.write(frame("pause-tv-off").repeat(50)); await vi.advanceTimersByTimeAsync(301);
      }
      expect(control).toHaveBeenCalledTimes(17); expect(events).not.toContain("pause-request");
      await vi.advanceTimersByTimeAsync(9000);
      expect(events.slice(0, 4)).toEqual(["wake-active", "wake-cancelled", "wake-closed", "pause-request"]);
      for (let count = 0; count < 5; count += 1) {
        reader.stdout.write(frame("pause-tv-off")); await vi.advanceTimersByTimeAsync(301);
      }
      expect(control).toHaveBeenCalledTimes(17);
      finishPause(); await vi.advanceTimersByTimeAsync(0);
      expect(events.slice(-2)).toEqual(["pause-ack", "sleep"]);
      expect(store.isAutomationPaused()).toBe(true); expect(store.getQueue()).toEqual(before);
      expect(load).not.toHaveBeenCalled(); expect(scheduler.status().lastError).toBeNull();
      // Settled allowance can be reused, while the normal 300ms debounce remains.
      reader.stdout.write(frame("pause-tv-off")); await vi.advanceTimersByTimeAsync(0);
      reader.stdout.write(frame("pause-tv-off")); await vi.advanceTimersByTimeAsync(0);
      expect(control).toHaveBeenCalledTimes(18);
      expect(events.filter((event) => event === "sleep")).toHaveLength(1); // already-asleep idempotence
    } finally {
      finishPause();
      const stopped = input.stop(); reader.close();
      const drained = scheduler.stop(); await vi.advanceTimersByTimeAsync(12_000);
      await Promise.all([stopped, drained]);
      expect(vi.getTimerCount()).toBe(0);
      store.close(); await rm(paths.root, { recursive: true, force: true });
    }
  });

  it.each(["pause", "sleep"] as const)("%s-held Off -> Chain -> eligible coalesced Off cancels new starts without another Off body", async (stage) => {
    const f = await heldOffFixture(stage);
    try {
      f.reader.stdout.write(frame("pause-tv-off")); await vi.advanceTimersByTimeAsync(0);
      expect(f.isHeld()).toBe(true);
      f.reader.stdout.write(frame("start-pippalot")); await vi.advanceTimersByTimeAsync(0);
      // A duplicate inside debounce and otherwise valid but invalid-boundary
      // frames must not cancel the new pending Chain.
      f.reader.stdout.write(frame("pause-tv-off"));
      for (const invalid of [{ command: "off" }, { at: Date.now() - 2001 }, { at: Date.now() + 2001 }, { version: 2 }]) {
        f.reader.stdout.write(frame("pause-tv-off", invalid));
      }
      f.reader.stdout.write("{malformed}\n" + "x".repeat(300) + "\n");
      expect(f.cancel).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(301);
      f.reader.stdout.write(frame("pause-tv-off")); // Cancels Chain 1, no second Off body.
      expect(f.cancel).toHaveBeenCalledTimes(1);
      f.reader.stdout.write(frame("start-pippalot")); // Newer Chain 2 must also be supersedable.
      f.reader.stdout.write(frame("pause-tv-off").repeat(100));
      expect(f.cancel).toHaveBeenCalledTimes(1); // Coalesced presses update debounce.
      await vi.advanceTimersByTimeAsync(301);
      f.reader.stdout.write(frame("pause-tv-off").repeat(100));
      expect(f.cancel).toHaveBeenCalledTimes(2);
      expect(f.control).toHaveBeenCalledTimes(3);
      expect(f.control.mock.calls.filter(([action]) => action === "pause-tv-off")).toHaveLength(1);
      expect(f.control.mock.calls[1]?.[1]?.()).toBe(true);
      expect(f.control.mock.calls[2]?.[1]?.()).toBe(true); // Both enter within 2s, not stale expiry.
      const first = expect(f.control.mock.results[1]!.value).rejects.toThrow("superseded");
      const second = expect(f.control.mock.results[2]!.value).rejects.toThrow("superseded");
      f.finish(); await vi.advanceTimersByTimeAsync(0);
      await Promise.all([f.control.mock.results[0]!.value, first, second]);
      expect(f.prepare).not.toHaveBeenCalled(); expect(f.load).not.toHaveBeenCalled();
      expect(f.calls.filter((command) => command.includes("KEYCODE_MEDIA_PAUSE"))).toHaveLength(1);
      expect(f.calls.filter((command) => command.includes("KEYCODE_SLEEP"))).toHaveLength(1);
      expect(f.calls.some((command) => /KEYCODE_WAKEUP|watch\?v=/.test(command))).toBe(false);
      expect(f.persist).toHaveBeenCalledExactlyOnceWith(true);
      expect(f.store.getQueue()).toEqual(f.before); expect(f.store.isAutomationPaused()).toBe(true);
      // Connection lifetime still gates cancellation admission, not just controls.
      f.reader.stdout.emit("end"); await vi.advanceTimersByTimeAsync(301);
      f.reader.stdout.write(frame("pause-tv-off"));
      expect(f.cancel).toHaveBeenCalledTimes(2); expect(f.control).toHaveBeenCalledTimes(3);
    } finally { await f.cleanup(); }
  });

  it("invalid/debounced input and invalid scheduler cancellation lifetime do not supersede an otherwise valid Chain", async () => {
    const f = await heldOffFixture("pause");
    try {
      f.reader.stdout.write(frame("pause-tv-off")); await vi.advanceTimersByTimeAsync(0);
      f.reader.stdout.write(frame("start-pippalot"));
      f.reader.stdout.write(frame("pause-tv-off")); // Still inside 300ms debounce.
      await vi.advanceTimersByTimeAsync(301);
      for (const invalid of [{ command: "off" }, { at: Date.now() - 2001 }, { at: Date.now() + 2001 }, { version: 2 }]) {
        f.reader.stdout.write(frame("pause-tv-off", invalid));
      }
      expect(f.cancel).not.toHaveBeenCalled();
      const lifetime = new AbortController();
      f.scheduler.cancelPresenterPreparation(() => false, lifetime.signal);
      lifetime.abort();
      f.scheduler.cancelPresenterPreparation(() => true, lifetime.signal);
      expect(f.control).toHaveBeenCalledTimes(2);
      // This valid fixture would wake/commit without an eligible Off. Its success
      // proves rejected cancellation isn't masked by cache or readiness failure.
      f.finish(); await vi.advanceTimersByTimeAsync(0);
      await Promise.all(f.control.mock.results.map((result) => result.value));
      expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.load).toHaveBeenCalledTimes(1);
      expect(f.calls.filter((command) => command.includes("KEYCODE_WAKEUP"))).toHaveLength(1);
      expect(f.calls.filter((command) => command.includes("KEYCODE_SLEEP"))).toHaveLength(1);
      expect(f.store.getQueue().items.map((item) => item.videoId)).toEqual(["GF3wagWwHjM"]);
      expect(f.store.getQueue().currentItemId).not.toBeNull(); expect(f.store.isAutomationPaused()).toBe(false);
    } finally { await f.cleanup(); }
  });
});
