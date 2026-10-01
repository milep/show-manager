import { spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresenterInput } from "../server/src/services/presenter-input";
import { presenterReaderSource } from "../server/src/services/presenter-reader-source";
import type { PresenterAction, YoutubeQueueScheduler } from "../server/src/services/youtube-queue-scheduler";

class ReaderFixture extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);
  process(): ChildProcessWithoutNullStreams { return this as unknown as ChildProcessWithoutNullStreams; }
  close(): void {
    this.emit("close", 0);
    this.stdin.destroy(); this.stdout.destroy(); this.stderr.destroy();
  }
}

function frame(action: PresenterAction, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: "hasacool", version: 1, action, at: Date.now(), ...extra }) + "\n";
}

async function fixture(control?: (action: PresenterAction, guard: () => boolean) => Promise<void>) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const readers: ReaderFixture[] = [];
  const actions: string[] = [];
  const scheduler = { control: vi.fn(control ?? (async (action, guard) => {
    if (guard()) actions.push(action);
  })) };
  const spawn = vi.fn((_args: string[]) => {
    const reader = new ReaderFixture();
    readers.push(reader);
    return reader.process();
  });
  const input = new PresenterInput("fixture-ssh-alias", scheduler as unknown as YoutubeQueueScheduler, spawn);
  input.start();
  await vi.advanceTimersByTimeAsync(12_000);
  const cleanup = async () => {
    const stopped = input.stop();
    readers.at(-1)?.close();
    await stopped;
    for (const reader of readers) {
      reader.stdin.destroy(); reader.stdout.destroy(); reader.stderr.destroy();
    }
  };
  return { input, readers, actions, scheduler, spawn, cleanup };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("HASACOOL Pi reader (Python standard library, synthetic fixtures)", () => {
  it("passes discovery, captured events, debounce, reattach, absence, permissions and lease tests", () => {
    const tests = readFileSync(new URL("./presenter-reader-fixture.py", import.meta.url), "utf8");
    const result = spawnSync("python3", ["-c", `__name__ = 'fixture'\n${presenterReaderSource}\n__name__ = '__main__'\n${tests}`], {
      encoding: "utf8", timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stderr).toContain("Ran 9 tests");
    expect(result.stderr).toContain("OK");
  });
});

describe("PresenterInput host stream", () => {
  it("waits the full initial lease window and cancels it on stop", async () => {
    vi.useFakeTimers();
    const control = vi.fn();
    const reader = new ReaderFixture();
    const spawn = vi.fn(() => reader.process());
    const input = new PresenterInput("fixture", { control } as unknown as YoutubeQueueScheduler, spawn);
    try {
      input.start();
      await vi.advanceTimersByTimeAsync(6000);
      input.start();
      await vi.advanceTimersByTimeAsync(5999);
      expect(spawn).not.toHaveBeenCalled();
      await input.stop();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(spawn).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      input.start();
      await vi.advanceTimersByTimeAsync(11_999);
      expect(spawn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(control).not.toHaveBeenCalled();
    } finally {
      const stopped = input.stop();
      reader.close();
      await stopped;
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it.each([0, 3000])("backend replacement after %ims cannot overlap a reader whose EOF is lost", async (restartDelay) => {
    vi.useFakeTimers();
    const control = vi.fn();
    const scheduler = { control } as unknown as YoutubeQueueScheduler;
    const readers: ReaderFixture[] = [];
    const remoteReaders = new Set<ReaderFixture>();
    const leases = new Map<ReaderFixture, NodeJS.Timeout>();
    let peakRemoteReaders = 0;
    const spawn = vi.fn(() => {
      const reader = new ReaderFixture();
      readers.push(reader);
      remoteReaders.add(reader);
      peakRemoteReaders = Math.max(peakRemoteReaders, remoteReaders.size);
      const heartbeat = () => {
        const previous = leases.get(reader);
        if (previous) clearTimeout(previous);
        leases.set(reader, setTimeout(() => {
          remoteReaders.delete(reader);
          leases.delete(reader);
        }, 10_000));
      };
      heartbeat();
      reader.stdin.on("data", heartbeat);
      // EOF and local SSH close deliberately do NOT terminate the remote fixture.
      return reader.process();
    });
    const old = new PresenterInput("fixture", scheduler, spawn);
    const replacement = new PresenterInput("fixture", scheduler, spawn);
    try {
      old.start();
      await vi.advanceTimersByTimeAsync(13_000); // Reader starts and receives a heartbeat.
      const oldReader = readers[0]!;
      const stopped = old.stop();
      oldReader.close();
      await stopped;
      await vi.advanceTimersByTimeAsync(restartDelay);
      expect(remoteReaders.has(oldReader)).toBe(true);
      replacement.start();
      await vi.advanceTimersByTimeAsync(9999 - restartDelay);
      expect(remoteReaders.has(oldReader)).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(remoteReaders.size).toBe(0);
      await vi.advanceTimersByTimeAsync(1999 + restartDelay);
      expect(spawn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(remoteReaders.size).toBe(1);
      expect(peakRemoteReaders).toBe(1);
      expect(control).not.toHaveBeenCalled();
    } finally {
      const stopped = replacement.stop();
      readers.at(-1)?.close();
      await Promise.all([old.stop(), stopped]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(remoteReaders.size).toBe(0);
      expect(leases.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      for (const reader of readers) {
        reader.stdin.destroy(); reader.stdout.destroy(); reader.stderr.destroy();
      }
    }
  });

  it("uses configured SSH identity, exactly framed actions and fixed debounce", async () => {
    const f = await fixture();
    try {
      f.input.start();
      expect(f.spawn).toHaveBeenCalledTimes(1);
      expect(f.spawn.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([
        "fixture-ssh-alias", "-T", "BatchMode=yes", "ServerAliveInterval=5", "ServerAliveCountMax=2",
      ]));
      const reader = f.readers[0]!;
      const play = frame("play");
      reader.stdout.write(play.slice(0, 12));
      reader.stdout.write(play.slice(12) + frame("pause") + frame("next"));
      await vi.advanceTimersByTimeAsync(93);
      reader.stdout.write(frame("play") + frame("next"));
      await vi.advanceTimersByTimeAsync(208);
      reader.stdout.write(frame("next"));
      await Promise.resolve();
      expect(f.actions).toEqual(["play", "pause", "next", "next"]);
    } finally { await f.cleanup(); }
  });

  it("accepts both fixed TV actions and aborts their operation lifetime on disconnect/stop", async () => {
    const f = await fixture();
    try {
      f.readers[0]!.stdout.write(frame("start-pippalot") + frame("pause-tv-off"));
      await Promise.resolve();
      expect(f.actions).toEqual(["start-pippalot", "pause-tv-off"]);
      const signal = (f.scheduler.control.mock.calls[0] as unknown as [string, () => boolean, AbortSignal])[2];
      expect(signal.aborted).toBe(false);
      // Entry freshness expires, but the connection's operation lifetime does not.
      await vi.advanceTimersByTimeAsync(2500);
      expect((f.scheduler.control.mock.calls[0]![1])()).toBe(false);
      expect(signal.aborted).toBe(false);
      f.readers[0]!.stdout.emit("end");
      expect(signal.aborted).toBe(true);
    } finally { await f.cleanup(); }
  });

  it("rejects malformed, oversized, stale, future and extra-field otherwise valid frames", async () => {
    const f = await fixture();
    try {
      const reader = f.readers[0]!;
      reader.stdout.write("play\n$(touch /not-executed)\n{broken}\n" + "x".repeat(100_000) + "\n");
      for (const invalid of [
        { type: "other" }, { version: 2 }, { action: "toggle" }, { at: "now" },
        { at: Date.now() - 2001 }, { at: Date.now() + 2001 }, { command: "pause" },
      ]) reader.stdout.write(frame("next", invalid));
      reader.stdout.write(frame("pause"));
      await Promise.resolve();
      expect(f.actions).toEqual(["pause"]);
    } finally { await f.cleanup(); }
  });

  it("cancels queued actions on disconnect, reconnects only after close and never replays", async () => {
    let runQueued: (() => void) | undefined;
    const actions: string[] = [];
    const f = await fixture((action, guard) => new Promise((resolve) => {
      runQueued = () => { if (guard()) actions.push(action); resolve(); };
    }));
    try {
      const first = f.readers[0]!;
      first.stdout.write(frame("next"));
      first.emit("error", new Error("fixture SSH failure"));
      runQueued?.();
      await vi.advanceTimersByTimeAsync(5000);
      expect(first.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
      expect(f.spawn).toHaveBeenCalledTimes(1);
      first.close();
      await vi.advanceTimersByTimeAsync(11_999);
      expect(f.spawn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(f.spawn).toHaveBeenCalledTimes(2);
      expect(actions).toEqual([]);
      expect(f.scheduler.control).toHaveBeenCalledTimes(1);
    } finally { await f.cleanup(); }
  });

  it("expires queued presses and contains ADB failures without terminating the reader", async () => {
    let runQueued: (() => void) | undefined;
    const actions: string[] = [];
    const f = await fixture((action, guard) => new Promise((resolve, reject) => {
      runQueued = () => {
        if (guard()) { actions.push(action); reject(new Error("fixture ADB failed")); }
        else resolve();
      };
    }));
    try {
      f.readers[0]!.stdout.write(frame("next"));
      await vi.advanceTimersByTimeAsync(2001);
      runQueued?.();
      await Promise.resolve();
      expect(actions).toEqual([]);
      f.readers[0]!.stdout.write(frame("pause"));
      runQueued?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(actions).toEqual(["pause"]);
      expect(f.spawn).toHaveBeenCalledTimes(1);
    } finally { await f.cleanup(); }
  });

  it("stop closes stdin, cancels queued work, waits for close and cancels reconnect", async () => {
    const f = await fixture();
    const reader = f.readers[0]!;
    const stopped = f.input.stop();
    expect(reader.stdin.writableEnded).toBe(true);
    reader.stdout.write(frame("play"));
    reader.close();
    await stopped;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(f.actions).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds queued presses and uses stop signal fallbacks without a duplicate reader", async () => {
    const pending: (() => void)[] = [];
    const actions: string[] = [];
    const f = await fixture((action, guard) => new Promise((resolve) => {
      pending.push(() => { if (guard()) actions.push(action); resolve(); });
    }));
    const reader = f.readers[0]!;
    try {
      for (let count = 0; count < 30; count += 1) {
        reader.stdout.write(frame("next"));
        await vi.advanceTimersByTimeAsync(301);
      }
      expect(f.scheduler.control).toHaveBeenCalledTimes(16);
      let closed = false;
      const stop = f.input.stop().then(() => { closed = true; });
      f.input.start();
      await vi.advanceTimersByTimeAsync(5000);
      expect(closed).toBe(false);
      expect(f.spawn).toHaveBeenCalledTimes(1);
      expect(reader.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
      pending.forEach((complete) => complete());
      reader.close();
      await stop;
      expect(actions).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally { await f.cleanup(); }
  });

  it("retries spawn failure without any playback intent", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const control = vi.fn();
    const spawn = vi.fn(() => { throw new Error("fixture absent ssh"); });
    const input = new PresenterInput("fixture", { control } as unknown as YoutubeQueueScheduler, spawn);
    input.start();
    await vi.advanceTimersByTimeAsync(48_000);
    expect(spawn).toHaveBeenCalledTimes(4);
    await input.stop();
    expect(control).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
