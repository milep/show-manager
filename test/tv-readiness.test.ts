import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { YoutubeQueueScheduler } from "../server/src/services/youtube-queue-scheduler";
import { YoutubeStore } from "../server/src/services/youtube-store";
import { AdbYoutubeController, nativeYoutubeForeground, parseTvPowerState } from "../server/src/services/adb-youtube-controller";
import type { CommandRunner } from "../server/src/services/run-command";
import { makeConfig, makeTempPaths } from "./test-helpers";
import { tclDozingPower } from "./tcl-adb-fixtures";

// Exact focus/activity lines reported by the supervisor's authorized TCL check.
const windowReady = `mCurrentFocus=Window{ceba5e4 u0 com.google.android.youtube.tv/com.google.android.apps.youtube.tv.activity.MainActivity}
mFocusedApp=ActivityRecord{8955c2c u0 com.google.android.youtube.tv/com.google.android.apps.youtube.tv.activity.MainActivity t2181}`;
const activityReady = "topResumedActivity=ActivityRecord{8955c2c u0 com.google.android.youtube.tv/com.google.android.apps.youtube.tv.activity.MainActivity t2181}";
const dreamingPower = `mWakefulness=Dreaming
mWakefulnessChanging=false
mIsPowered=true`;
const dreamingFocus = "mCurrentFocus=Window{cde73c u0 com.google.android.apps.tv.dreamx/android.service.dreams.DreamActivity}";
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function fixture(initial = "Awake") {
  let power = initial;
  let boot = "1";
  let window = windowReady;
  let activity = activityReady;
  let wakeWorks = true;
  let sleepWorks = true;
  let launch = "Starting: Intent { pkg=com.google.android.youtube.tv }";
  const calls: string[] = [];
  const run: CommandRunner = vi.fn(async (command, args, options) => {
    expect(command).toBe("ssh");
    expect(args).toContain("synthetic-pi");
    expect(options?.timeoutMs).toBe(12_000);
    const shell = args.at(-1)!;
    calls.push(shell);
    expect(shell).toMatch(/^python3 -c /);
    expect(shell).toContain("timeout=5");
    if (shell.includes("'shell'")) expect(shell).toContain("'-s' 'synthetic-tv:5555' 'shell'");
    let stdout = "";
    if (shell.includes("'power'")) stdout = power === "Dreaming" ? dreamingPower : `Power Manager State:\n  mWakefulness=${power}\n`;
    if (shell.includes("KEYCODE_WAKEUP") && wakeWorks) power = "Awake";
    if (shell.includes("KEYCODE_SLEEP") && sleepWorks) power = "Asleep";
    if (shell.includes("'getprop'")) stdout = boot;
    if (shell.includes("'window'")) {
      expect(shell).toContain("'shell' 'dumpsys' 'window' 'displays'");
      stdout = window;
    }
    if (shell.includes("'activities'")) stdout = activity;
    if (shell.includes("'start'")) stdout = launch;
    return { stdout, stderr: "" };
  });
  const controller = new AdbYoutubeController({ ...makeConfig("/tmp/synthetic-tv"), raspSshTarget: "synthetic-pi", adbTvTarget: "synthetic-tv:5555" }, run);
  return { controller, run, calls, setPower: (value: string) => { power = value; }, setBoot: (value: string) => { boot = value; },
    setForeground: (w: string, a: string) => { window = w; activity = a; },
    disableWake: () => { wakeWorks = false; }, disableSleep: () => { sleepWorks = false; }, setLaunch: (value: string) => { launch = value; } };
}

describe("TCL explicit power and native YouTube preparation", () => {
  it("parses only unambiguous reported Awake/Asleep/Dreaming, never guessing unknown states", () => {
    expect(parseTvPowerState("  mWakefulness=Awake\n")).toBe("awake");
    expect(parseTvPowerState("  mWakefulness=Asleep\n")).toBe("asleep");
    expect(parseTvPowerState(dreamingPower)).toBe("dreaming");
    expect(parseTvPowerState(tclDozingPower)).toBe("transitioning");
    expect(parseTvPowerState("mWakefulness=Asleep\nmWakefulnessChanging=true")).toBe("transitioning");
    expect(parseTvPowerState("mWakefulness=Awake\nmWakefulnessChanging=true")).toBe("transitioning");
    for (const state of ["", "mWakefulness=DozeSuspend", "mWakefulness=Unknown\nmWakefulnessChanging=true",
      "mWakefulness=Asleep\nmWakefulnessChanging=invalid", "mWakefulness=Asleep\nmWakefulnessChanging=false\nmWakefulnessChanging=true", "mWakefulness=DreamingUnknown", "mWakefulness=Awake\nmWakefulness=Asleep",
      "mWakefulness=Dreaming\nmWakefulness=Awake", "mWakefulnessChanging=false\nmIsPowered=true", "mWakefulnessChanging=true"]) {
      expect(() => parseTvPowerState(state)).toThrow("unknown");
    }
  });

  it("requires native window focus AND resumed activity, not session/ping or HDMI", () => {
    expect(nativeYoutubeForeground(windowReady, activityReady)).toBe(true);
    expect(nativeYoutubeForeground(windowReady, activityReady.replace("topResumedActivity=", "mResumedActivity: "))).toBe(true);
    expect(nativeYoutubeForeground(windowReady, activityReady.replace("topResumedActivity", "mResumedActivity"))).toBe(true);
    for (const [w, a] of [["package=com.google.android.youtube.tv", activityReady], [windowReady, "package=com.google.android.youtube.tv"],
      [windowReady.replace("youtube.tv/", "youtube.tv.other/"), activityReady], ["mCurrentFocus=Window{com.tcl.tv/.HDMI}", activityReady],
      [windowReady.replace("mCurrentFocus=", ""), activityReady], // Native window record/focused app alone is insufficient.
      [windowReady.split("\n")[1], activityReady],
      [windowReady, activityReady.replace("youtube.tv/", "tcl.tv/")], [dreamingFocus, activityReady]]) {
      expect(nativeYoutubeForeground(w!, a!)).toBe(false);
    }
  });

  it("accepts the observed TCL display focus and top-resumed output with the explicit configured query", async () => {
    const f = fixture("Asleep");
    await f.controller.prepareYoutube();
    expect(f.calls.filter((call) => call.includes("'window'"))).toEqual([
      expect.stringContaining("'-s' 'synthetic-tv:5555' 'shell' 'dumpsys' 'window' 'displays'"),
    ]);
    expect(f.calls.filter((call) => call.includes("'activities'"))).toHaveLength(1);
    expect(f.calls.filter((call) => call.includes("KEYCODE_WAKEUP"))).toHaveLength(1);
    expect(f.calls.filter((call) => call.includes("'start'"))).toHaveLength(1);
  });

  it("native records/focused app without mCurrentFocus never satisfy readiness or loosen the deadline", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.setForeground(windowReady.replace("mCurrentFocus=", ""), activityReady);
    const rejected = expect(f.controller.prepareYoutube()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(30_000); await rejected;
    expect(f.calls.filter((call) => call.includes("'window'"))).toHaveLength(60);
    expect(f.calls.filter((call) => call.includes("'start'"))).toHaveLength(1);
    expect(f.calls.join("\n")).not.toContain("watch?v=");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recognizes observed screensaver power, exits with one wake and waits for exact Awake/native readiness", async () => {
    vi.useFakeTimers();
    const f = fixture("Dreaming"); f.disableWake(); f.setForeground(dreamingFocus, activityReady);
    await expect(f.controller.getPowerState()).resolves.toBe("dreaming");
    let settled = false;
    const prepared = f.controller.prepareYoutube().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.calls.filter((call) => call.includes("KEYCODE_WAKEUP"))).toHaveLength(1);
    expect(f.calls.some((call) => call.includes("'start'"))).toBe(false);
    f.setPower("Awake"); await vi.advanceTimersByTimeAsync(500);
    expect(f.calls.filter((call) => call.includes("'start'"))).toHaveLength(1);
    expect(settled).toBe(false); // Awake alone does not replace the dream's focus.
    f.setForeground(windowReady, activityReady); await vi.advanceTimersByTimeAsync(500); await prepared;
    expect(settled).toBe(true);
    await f.controller.prepareYoutube(); // Already Awake never repeats the wake.
    expect(f.calls.filter((call) => call.includes("KEYCODE_WAKEUP"))).toHaveLength(1);
    expect(f.calls.join("\n")).not.toMatch(/KEYCODE_POWER|KEYCODE_SLEEP/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["power", "focus"] as const)("screensaver %s remaining unready fails at the unchanged 30s deadline", async (stage) => {
    vi.useFakeTimers();
    const f = fixture("Dreaming");
    if (stage === "power") f.disableWake(); // Otherwise valid native focus/resumed must not imply Awake.
    else f.setForeground(dreamingFocus, activityReady); // Awake but screensaver-focused must not imply readiness.
    const rejected = expect(f.controller.prepareYoutube()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(30_000); await rejected;
    expect(f.calls.filter((call) => call.includes("KEYCODE_WAKEUP"))).toHaveLength(1);
    expect(f.calls.filter((call) => call.includes("'start'"))).toHaveLength(stage === "power" ? 0 : 1);
    expect(f.calls.join("\n")).not.toMatch(/KEYCODE_POWER|watch\?v=/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["Awake", "Asleep", "Dreaming"])("%s wakes only if needed, waits boot and foreground, launches exactly once", async (initial) => {
    vi.useFakeTimers();
    const f = fixture(initial); f.setBoot("0");
    const prepared = f.controller.prepareYoutube();
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.calls.some((call) => call.includes("'start'"))).toBe(false);
    f.setBoot("1"); f.setForeground("mCurrentFocus=Window{com.tcl.tv/.HDMI}", activityReady);
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.calls.filter((call) => call.includes("'start'"))).toHaveLength(1);
    f.setForeground(windowReady, activityReady);
    await vi.advanceTimersByTimeAsync(500); await prepared;
    expect(f.calls.filter((call) => call.includes("KEYCODE_WAKEUP"))).toHaveLength(initial === "Awake" ? 0 : 1);
    expect(f.calls.filter((call) => call.includes("'start'"))).toHaveLength(1);
    expect(f.calls.join("\n")).not.toMatch(/KEYCODE_POWER|KEYCODE_SLEEP|watch\?v=/);
  });

  it.each(["DozeSuspend", "offline", "app-error"])("%s fails without a power toggle or video launch", async (failure) => {
    vi.useFakeTimers();
    const f = fixture(failure === "DozeSuspend" ? "DozeSuspend" : "Awake");
    if (failure === "offline") vi.mocked(f.run).mockRejectedValue(new Error("device offline"));
    if (failure === "app-error") f.setLaunch("Error: Activity not found");
    const rejected = expect(f.controller.prepareYoutube()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(11_500); await rejected;
    expect(f.calls.join("\n")).not.toMatch(/KEYCODE_POWER|KEYCODE_WAKEUP|watch\?v=/);
  });

  it.each(["boot", "foreground", "wake"])("%s unready hits the 30s finite deadline and stops polling", async (failure) => {
    vi.useFakeTimers();
    const f = fixture(failure === "wake" ? "Asleep" : "Awake");
    if (failure === "boot") f.setBoot("0");
    if (failure === "foreground") f.setForeground("", "");
    if (failure === "wake") f.disableWake();
    const rejected = expect(f.controller.prepareYoutube()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(41_500); await rejected;
    const count = f.calls.length;
    expect(count).toBeLessThan(400);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(f.calls).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("deadline cancels the underlying runner and drains its remote watchdog before returning", async () => {
    vi.useFakeTimers();
    let active = 0;
    let tornDown = false;
    const run: CommandRunner = (_command, _args, options) => new Promise((_resolve, reject) => {
      active += 1;
      options!.signal!.addEventListener("abort", () => {
        active -= 1; tornDown = true; reject(new Error("synthetic child closed"));
      }, { once: true });
    });
    const controller = new AdbYoutubeController(makeConfig("/tmp/synthetic"), run);
    let settled = false;
    const rejected = expect(controller.prepareYoutube().finally(() => { settled = true; })).rejects.toThrow("synthetic child closed");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(tornDown).toBe(true); expect(active).toBe(0); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(11_000); await rejected;
    expect(settled).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it("parent cancellation aborts active readiness, not just an awaited Promise", async () => {
    vi.useFakeTimers();
    const f = fixture(); f.setBoot("0");
    const parent = new AbortController();
    const rejected = expect(f.controller.prepareYoutube(parent.signal)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1000); parent.abort();
    await vi.advanceTimersByTimeAsync(11_500); await rejected;
    const count = f.calls.length; await vi.advanceTimersByTimeAsync(30_000);
    expect(f.calls).toHaveLength(count); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["Awake", "Asleep", "Dreaming"])("sleep from %s is explicit and verified/idempotent", async (initial) => {
    const f = fixture(initial); await f.controller.sleepAndVerify();
    await f.controller.sleepAndVerify();
    expect(f.calls.filter((call) => call.includes("KEYCODE_SLEEP"))).toHaveLength(initial === "Asleep" ? 0 : 1);
    expect(f.calls.join("\n")).not.toMatch(/KEYCODE_POWER|KEYCODE_WAKEUP|KEYCODE_MEDIA_PLAY/);
  });

  it("Dreaming is not an off-verification success and retains the 10s sleep deadline", async () => {
    vi.useFakeTimers();
    const f = fixture("Dreaming"); f.disableSleep();
    const rejected = expect(f.controller.sleepAndVerify()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10_000); await rejected;
    expect(f.calls.filter((call) => call.includes("KEYCODE_SLEEP"))).toHaveLength(1);
    expect(f.calls.join("\n")).not.toMatch(/KEYCODE_WAKEUP|KEYCODE_POWER/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("observed Dreaming Off pauses/persists before explicit sleep, retains queue/current and stays idempotent", async () => {
    const paths = await makeTempPaths();
    const store = new YoutubeStore(paths);
    store.addToQueue({ sourceId: "Tb0MC0jFv6M", url: "https://youtu.be/Tb0MC0jFv6M" });
    store.markPlaying(store.firstPending()!.id);
    const before = store.getQueue();
    const f = fixture("Dreaming");
    const scheduler = new YoutubeQueueScheduler(store, f.controller);
    const persist = store.setAutomationPaused.bind(store);
    vi.spyOn(store, "setAutomationPaused").mockImplementation((paused) => { persist(paused); f.calls.push(`persist:${paused}`); });
    const load = vi.spyOn(store, "loadPippalotToQueue");
    try {
      await scheduler.control("pause-tv-off");
      expect(f.calls.filter((call) => /KEYCODE_MEDIA_PAUSE|persist:|KEYCODE_SLEEP/.test(call))).toEqual([
        expect.stringContaining("KEYCODE_MEDIA_PAUSE"), "persist:true", expect.stringContaining("KEYCODE_SLEEP"),
      ]);
      expect(store.isAutomationPaused()).toBe(true); expect(store.getQueue()).toEqual(before);
      await expect(f.controller.getPowerState()).resolves.toBe("asleep");
      await scheduler.control("pause-tv-off");
      expect(f.calls.filter((call) => call.includes("KEYCODE_MEDIA_PAUSE"))).toHaveLength(1);
      expect(f.calls.filter((call) => call.includes("KEYCODE_SLEEP"))).toHaveLength(1);
      expect(f.calls.join("\n")).not.toMatch(/KEYCODE_WAKEUP|KEYCODE_POWER|watch\?v=/);
      expect(load).not.toHaveBeenCalled(); expect(store.getQueue()).toEqual(before);
      const reopened = new YoutubeStore(paths);
      try { expect(reopened.isAutomationPaused()).toBe(true); expect(reopened.getQueue()).toEqual(before); } finally { reopened.close(); }
    } finally { await scheduler.stop(); store.close(); await rm(paths.root, { recursive: true, force: true }); }
  });

  it("failed sleep times out, unknown sleep state and offline do not report success", async () => {
    vi.useFakeTimers();
    const f = fixture(); f.disableSleep();
    const rejected = expect(f.controller.sleepAndVerify()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(16_500); await rejected;
    expect(vi.getTimerCount()).toBe(0);
    f.setPower("DozeSuspend"); await expect(f.controller.sleepAndVerify()).rejects.toThrow("unknown");
    vi.mocked(f.run).mockRejectedValue(new Error("offline"));
    const offline = expect(f.controller.sleepAndVerify()).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(11_000); await offline;
  });
});
