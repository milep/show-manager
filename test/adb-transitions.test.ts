import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdbYoutubeController } from "../server/src/services/adb-youtube-controller";
import type { CommandRunner } from "../server/src/services/run-command";
import { YoutubeQueueScheduler } from "../server/src/services/youtube-queue-scheduler";
import { YoutubeStore } from "../server/src/services/youtube-store";
import { makeConfig, makeTempPaths } from "./test-helpers";
import { tclAsleepPower, tclDozingPower, tclPlayingState } from "./tcl-adb-fixtures";

const awake = "mWakefulness=Awake\nmWakefulnessChanging=false";
const dreaming = "mWakefulness=Dreaming\nmWakefulnessChanging=false";
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function fixture(initial: string[] = [awake]) {
  let reads = [...initial];
  let lastPower = initial.at(-1)!;
  let wakeReads = [awake];
  let sleepReads = [tclAsleepPower];
  let media = tclPlayingState;
  const calls: string[] = [];
  const observed: string[] = [];
  const events: string[] = [];
  const setPower = (sequence: string[]) => { reads = [...sequence]; lastPower = sequence.at(-1)!; };
  const run: CommandRunner = vi.fn(async (command, args, options) => {
    expect(command).toBe("ssh"); expect(options?.timeoutMs).toBe(12_000);
    const shell = args.at(-1)!; calls.push(shell);
    if (shell.includes("'shell'")) expect(shell).toContain("'-s' 'synthetic-tv:5555'");
    let stdout = "";
    if (shell.includes("'power'")) { stdout = reads.shift() ?? lastPower; observed.push(stdout); }
    if (shell.includes("KEYCODE_WAKEUP")) { events.push("wake"); setPower(wakeReads); }
    if (shell.includes("KEYCODE_SLEEP")) { events.push("sleep"); setPower(sleepReads); }
    if (shell.includes("KEYCODE_POWER")) events.push("toggle");
    if (shell.includes("KEYCODE_MEDIA_PAUSE")) events.push("pause");
    if (shell.includes("'getprop'")) stdout = "1";
    if (shell.includes("'window'")) {
      expect(shell).toContain("'dumpsys' 'window' 'displays'");
      stdout = "mCurrentFocus=Window{ceba5e4 u0 com.google.android.youtube.tv/com.google.android.apps.youtube.tv.activity.MainActivity}";
    }
    if (shell.includes("'activities'")) stdout = "topResumedActivity=ActivityRecord{8955c2c u0 com.google.android.youtube.tv/com.google.android.apps.youtube.tv.activity.MainActivity t2181}";
    if (shell.includes("'start'")) events.push(shell.includes("watch?v=") ? "video" : "app");
    if (shell.includes("'media_session'")) stdout = `package=com.google.android.youtube.tv\n${media}`;
    return { stdout, stderr: "" };
  });
  const controller = new AdbYoutubeController({ ...makeConfig("/tmp/synthetic-transitions"), adbTvTarget: "synthetic-tv:5555" }, run);
  return { controller, run, calls, observed, events, setPower,
    onWake: (sequence: string[]) => { wakeReads = sequence; },
    onSleep: (sequence: string[]) => { sleepReads = sequence; },
    setMedia: (value: string) => { media = value; } };
}
async function queueFixture(f: ReturnType<typeof fixture>) {
  const paths = await makeTempPaths(); const store = new YoutubeStore(paths);
  for (const id of ["GF3wagWwHjM", "Kdg4DLAPC4A"]) store.addToQueue({ sourceId: id, url: `https://youtu.be/${id}` });
  store.markPlaying(store.firstPending()!.id);
  const before = store.getQueue();
  const scheduler = new YoutubeQueueScheduler(store, f.controller);
  const load = vi.spyOn(store, "loadPippalotToQueue");
  const persist = store.setAutomationPaused.bind(store);
  vi.spyOn(store, "setAutomationPaused").mockImplementation((paused) => { persist(paused); f.events.push(`persist:${paused}`); });
  return { store, before, scheduler, load, paths, cleanup: async () => {
    const stopped = scheduler.stop(); await vi.advanceTimersByTimeAsync(42_000); await stopped;
    expect(vi.getTimerCount()).toBe(0); store.close(); await rm(paths.root, { recursive: true, force: true });
  } };
}

describe("TCL transient power with existing bounded decisions", () => {
  it.each([[tclAsleepPower, "asleep"], [awake, "awake"], [dreaming, "dreaming"]] as const)("initial Dozing waits for stable %s (%s), without power permission", async (stable, expected) => {
    vi.useFakeTimers(); const f = fixture([tclDozingPower, tclDozingPower, stable]);
    let returned: string | undefined;
    const result = f.controller.getPowerState().then((power) => { returned = power; });
    await vi.advanceTimersByTimeAsync(999);
    expect(returned).toBeUndefined(); expect(f.events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1); await result;
    expect(returned).toBe(expected); expect(f.observed).toEqual([tclDozingPower, tclDozingPower, stable]);
    expect(f.events).toEqual([]); expect(vi.getTimerCount()).toBe(0);
  });

  it("reported Asleep while changing is not an already-off decision", async () => {
    vi.useFakeTimers(); const f = fixture(["mWakefulness=Asleep\nmWakefulnessChanging=true", tclAsleepPower]);
    let settled = false;
    const result = f.controller.sleepAndVerify().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(499); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await result;
    expect(settled).toBe(true); expect(f.events).toEqual([]); expect(vi.getTimerCount()).toBe(0);
  });

  it("preparation waits stable initial state before wake, then polls through Dozing until exact Awake/native readiness", async () => {
    vi.useFakeTimers(); const f = fixture([tclDozingPower, tclAsleepPower]);
    f.onWake([tclDozingPower, tclDozingPower, awake]);
    let settled = false;
    const prepared = f.controller.prepareYoutube().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(499); expect(f.events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1); expect(f.events).toEqual(["wake"]); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(999); expect(f.events).toEqual(["wake"]); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await prepared;
    expect(f.events).toEqual(["wake", "app"]); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["getPowerState", "prepareYoutube", "sleepAndVerify"] as const)("%s transient-only initial state fails within its existing budget", async (method) => {
    vi.useFakeTimers(); const f = fixture([tclDozingPower]);
    const ms = method === "prepareYoutube" ? 30_000 : 10_000;
    const rejected = expect(f.controller[method]()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(ms); await rejected;
    expect(f.observed).toHaveLength(ms / 500); expect(f.events).toEqual([]);
    const count = f.calls.length; await vi.advanceTimersByTimeAsync(30_000);
    expect(f.calls).toHaveLength(count); expect(vi.getTimerCount()).toBe(0);
  });

  it("initial wait and post-wake readiness share one 30s budget, not two deadlines", async () => {
    vi.useFakeTimers(); const f = fixture([tclDozingPower]);
    f.onWake([tclDozingPower]);
    const rejected = expect(f.controller.prepareYoutube()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(20_000); f.setPower([tclAsleepPower]);
    await vi.advanceTimersByTimeAsync(10_000); await rejected;
    expect(f.events).toEqual(["wake"]); expect(vi.getTimerCount()).toBe(0);
  });

  it("initial wait and post-sleep verification share one 10s budget", async () => {
    vi.useFakeTimers(); const f = fixture([tclDozingPower]); f.onSleep([tclDozingPower]);
    const rejected = expect(f.controller.sleepAndVerify()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(6000); f.setPower([awake]);
    await vi.advanceTimersByTimeAsync(4000); await rejected;
    expect(f.events).toEqual(["sleep"]); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["getPowerState", "prepareYoutube", "sleepAndVerify"] as const)("%s cancellation tears down stable-state polling", async (method) => {
    vi.useFakeTimers(); const f = fixture([tclDozingPower]); const lifetime = new AbortController();
    const rejected = expect(f.controller[method](lifetime.signal)).rejects.toThrow("cancelled");
    await vi.advanceTimersByTimeAsync(501); const count = f.calls.length;
    lifetime.abort(); await vi.advanceTimersByTimeAsync(0); await rejected;
    await vi.advanceTimersByTimeAsync(42_000);
    expect(f.calls).toHaveLength(count); expect(f.events).toEqual([]); expect(vi.getTimerCount()).toBe(0);
  });

  it("stable-state wait aborts its active command fixture and retains 11s remote quarantine", async () => {
    vi.useFakeTimers(); const f = fixture(); const lifetime = new AbortController();
    let active = 0; let closed = false; let settled = false;
    vi.mocked(f.run).mockImplementationOnce((_command, _args, options) => new Promise((_resolve, reject) => {
      active += 1;
      options!.signal!.addEventListener("abort", () => { active -= 1; closed = true; reject(new Error("command fixture closed")); }, { once: true });
    }));
    const rejected = expect(f.controller.getPowerState(lifetime.signal).finally(() => { settled = true; })).rejects.toThrow("fixture closed");
    await vi.advanceTimersByTimeAsync(0); expect(active).toBe(1);
    lifetime.abort(); await vi.advanceTimersByTimeAsync(10_999);
    expect(closed).toBe(true); expect(active).toBe(0); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await rejected; expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["mWakefulness=Unknown\nmWakefulnessChanging=true", "mWakefulness=Asleep\nmWakefulness=Awake"])("unknown/ambiguous output after Dozing fails closed: %s", async (invalid) => {
    vi.useFakeTimers(); const f = fixture([tclDozingPower, invalid]);
    const rejected = expect(f.controller.prepareYoutube()).rejects.toThrow("unknown");
    await vi.advanceTimersByTimeAsync(500); await rejected;
    expect(f.events).toEqual([]); expect(vi.getTimerCount()).toBe(0);
  });

  it("captured Dozing poll0/poll1 then stable Asleep verifies Off only after persisted pause", async () => {
    vi.useFakeTimers(); const f = fixture(); f.onSleep([tclDozingPower, tclDozingPower, tclAsleepPower]);
    const q = await queueFixture(f);
    try {
      let settled = false;
      const off = q.scheduler.control("pause-tv-off").then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(999);
      expect(settled).toBe(false); expect(f.events).toEqual(["pause", "persist:true", "sleep"]);
      expect(q.store.isAutomationPaused()).toBe(true); expect(q.store.getQueue()).toEqual(q.before);
      expect(f.observed.slice(-2)).toEqual([tclDozingPower, tclDozingPower]);
      await vi.advanceTimersByTimeAsync(1); await off;
      expect(f.observed.at(-1)).toBe(tclAsleepPower); expect(settled).toBe(true);
      await q.scheduler.control("pause-tv-off");
      expect(f.events.filter((event) => event === "pause")).toHaveLength(1);
      expect(f.events.filter((event) => event === "sleep")).toHaveLength(1);
      expect(f.events).not.toContain("wake"); expect(f.events).not.toContain("toggle");
      expect(q.load).not.toHaveBeenCalled(); expect(q.store.getQueue()).toEqual(q.before);
      const reopened = new YoutubeStore(q.paths);
      try { expect(reopened.isAutomationPaused()).toBe(true); expect(reopened.getQueue()).toEqual(q.before); } finally { reopened.close(); }
    } finally { await q.cleanup(); }
  });

  it.each(["initial", "after-pause"] as const)("%s transient timeout preserves queue and the correct pause intent", async (stage) => {
    vi.useFakeTimers(); const f = fixture(stage === "initial" ? [tclDozingPower] : [awake]);
    f.onSleep([tclDozingPower]); const q = await queueFixture(f);
    try {
      const rejected = expect(q.scheduler.control("pause-tv-off")).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(10_000); await rejected;
      expect(q.store.isAutomationPaused()).toBe(stage === "after-pause");
      expect(q.store.getQueue()).toEqual(q.before); expect(q.load).not.toHaveBeenCalled();
      expect(f.events).toEqual(stage === "initial" ? [] : ["pause", "persist:true", "sleep"]);
      expect(q.scheduler.status().lastError).not.toBeNull();
    } finally { await q.cleanup(); }
  });

  it("unknown output after successful pause and a Dozing poll reports failure while retaining pause/queue", async () => {
    vi.useFakeTimers(); const f = fixture();
    f.onSleep([tclDozingPower, "mWakefulness=Unknown\nmWakefulnessChanging=true"]);
    const q = await queueFixture(f);
    try {
      const rejected = expect(q.scheduler.control("pause-tv-off")).rejects.toThrow("unknown");
      await vi.advanceTimersByTimeAsync(500); await rejected;
      expect(q.store.isAutomationPaused()).toBe(true); expect(q.store.getQueue()).toEqual(q.before);
      expect(f.events).toEqual(["pause", "persist:true", "sleep"]); expect(q.load).not.toHaveBeenCalled();
    } finally { await q.cleanup(); }
  });

  it("scheduler stop cancels an Off stable-state wait before pause or sleep", async () => {
    vi.useFakeTimers(); const f = fixture([tclDozingPower]); const q = await queueFixture(f);
    try {
      const rejected = expect(q.scheduler.control("pause-tv-off")).rejects.toThrow("cancelled");
      await vi.advanceTimersByTimeAsync(501); const count = f.calls.length;
      const stopped = q.scheduler.stop(); await vi.advanceTimersByTimeAsync(0); await Promise.all([stopped, rejected]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(f.calls).toHaveLength(count); expect(f.events).toEqual([]);
      expect(q.store.isAutomationPaused()).toBe(false); expect(q.store.getQueue()).toEqual(q.before);
      expect(q.load).not.toHaveBeenCalled();
    } finally { await q.cleanup(); }
  });

  it("Off supersedes an initial Dozing preparation before any wake or cache commit", async () => {
    vi.useFakeTimers(); const f = fixture([tclDozingPower]); const q = await queueFixture(f);
    try {
      q.store.setAutomationPaused(true); f.events.length = 0;
      const cancelled = expect(q.scheduler.control("start-pippalot")).rejects.toThrow("cancelled");
      await vi.advanceTimersByTimeAsync(501);
      f.setPower([tclAsleepPower]); const off = q.scheduler.control("pause-tv-off");
      await vi.advanceTimersByTimeAsync(0); await Promise.all([cancelled, off]);
      expect(f.events).toEqual(["persist:true"]); expect(q.load).not.toHaveBeenCalled();
      expect(q.store.getQueue()).toEqual(q.before); expect(q.store.isAutomationPaused()).toBe(true);
    } finally { await q.cleanup(); }
  });

  it("symbolic playback retains active current, rejects malformed state and advances STOPPED exactly like numeric", async () => {
    vi.useFakeTimers(); const f = fixture(); const q = await queueFixture(f);
    try {
      await vi.advanceTimersByTimeAsync(16_000); // Existing startup grace has elapsed.
      await q.scheduler.tick();
      expect(q.scheduler.getCachedPlaybackStatus()?.state).toBe("playing");
      expect(q.scheduler.getCachedPlaybackStatus()?.positionMs).toBe(250);
      expect(q.store.getQueue().currentItemId).toBe(q.before.currentItemId);
      f.setMedia(tclPlayingState.replace("PLAYING(3)", "PAUSED(2)")); await q.scheduler.tick();
      expect(q.scheduler.getCachedPlaybackStatus()?.state).toBe("paused");
      f.setMedia(tclPlayingState.replace("PLAYING(3)", "PAUSED(3)")); await q.scheduler.tick();
      expect(q.scheduler.getCachedPlaybackStatus()?.state).toBe("unknown");
      expect(q.store.getQueue().currentItemId).toBe(q.before.currentItemId); expect(f.events).not.toContain("video");
      f.setMedia(tclPlayingState.replace("PLAYING(3)", "STOPPED(1)")); await q.scheduler.tick();
      expect(q.store.getQueue().currentItemId).not.toBe(q.before.currentItemId);
      expect(q.store.listCompletedQueueItems().map((item) => item.videoId)).toEqual(["GF3wagWwHjM"]);
      expect(f.events.filter((event) => event === "video")).toHaveLength(1);
    } finally { await q.cleanup(); }
  });
});
