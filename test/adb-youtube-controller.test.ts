import { describe, expect, it } from "vitest";
import { AdbYoutubeController, boundedAdbSource, parseYoutubePlaybackStatus } from "../server/src/services/adb-youtube-controller";
import { makeConfig } from "./test-helpers";
import { tclPlayingState } from "./tcl-adb-fixtures";

const remotePrefix = `python3 -c '${boundedAdbSource.replaceAll("'", `'"'"'`)}' adb `;

const dumpsys = `
Sessions Stack - have 3 sessions:
  MediaSessionRecord{abc com.google.android.youtube.tv/YouTube}
      package=com.google.android.youtube.tv
      state=PlaybackState {state=3, position=433, buffered position=0, speed=1.0, updated=528700485, actions=382, custom actions=[], active item id=-1, error=null}
      metadata: size=5, description=The Chosen Legacy, Dimmu Borgir, null
  CastMediaSession com.google.android.apps.mediashell/CastMediaSession
      package=com.google.android.apps.mediashell
      state=PlaybackState {state=6, position=0, buffered position=0, speed=1.0, updated=527851889, actions=951, custom actions=[], active item id=-1, error=null}
      metadata: size=11, description=Stale Cast Item, null, null
`;

describe("parseYoutubePlaybackStatus", () => {
  it("parses native YouTube session", () => {
    const status = parseYoutubePlaybackStatus(dumpsys);
    expect(status.connected).toBe(true);
    expect(status.state).toBe("playing");
    expect(status.title).toBe("The Chosen Legacy");
    expect(status.subtitle).toBe("Dimmu Borgir");
    expect(status.album).toBeNull();
    expect(status.positionMs).toBe(433);
  });

  it("parses the exact captured symbolic PLAYING state without losing position or detail", () => {
    const status = parseYoutubePlaybackStatus(`package=com.google.android.youtube.tv\n${tclPlayingState}`);
    expect(status.state).toBe("playing"); expect(status.positionMs).toBe(250);
    expect(status.detail).toBe(tclPlayingState);
  });

  it.each([
    ["3", "playing"], ["2", "paused"], ["1", "idle"], ["0", "idle"],
    ["PLAYING(3)", "playing"], ["PAUSED(2)", "paused"], ["STOPPED(1)", "idle"],
    ["NONE(0)", "idle"], ["BUFFERING(6)", "buffering"], ["ERROR(7)", "error"],
    ["99", "unknown"], ["PAUSED(3)", "unknown"], ["INVALID(3)", "unknown"],
    ["PLAYING(x)", "unknown"], ["PLAYING(3", "unknown"], ["3garbage", "unknown"],
    ["3.5", "unknown"], ["-1", "unknown"], ["playing(3)", "unknown"],
  ] as const)("%s playback token is %s", (token, expected) => {
    const status = parseYoutubePlaybackStatus(`package=com.google.android.youtube.tv\nstate=PlaybackState {state=${token}, position=250, error=state=3}`);
    expect(status.state).toBe(expected); expect(status.positionMs).toBe(250);
    expect(status.connected).toBe(true);
  });

  it("parses YouTube Music album field", () => {
    const status = parseYoutubePlaybackStatus(`package=com.google.android.youtube.tv
state=PlaybackState {state=3, position=0, speed=1.0}
metadata: size=5, description=The Shadow Elite, Behemoth, The Shadow Elite`);

    expect(status.title).toBe("The Shadow Elite");
    expect(status.subtitle).toBe("Behemoth");
    expect(status.album).toBe("The Shadow Elite");
  });

  it("ignores missing native YouTube session", () => {
    const status = parseYoutubePlaybackStatus("package=com.google.android.apps.mediashell");
    expect(status.state).toBe("idle");
  });
});

describe("AdbYoutubeController", () => {
  it("toggles TV power through ssh adb", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = new AdbYoutubeController(makeConfig("/tmp/show-manager"), async (command, args) => {
      calls.push({ command, args });
      return { stdout: "", stderr: "" };
    });

    await controller.togglePower();

    expect(calls).toEqual([
      { command: "ssh", args: ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "rasp", remotePrefix + "'connect' '192.168.1.104:5555'"] },
      { command: "ssh", args: ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "rasp", remotePrefix + "'-s' '192.168.1.104:5555' 'shell' 'input' 'keyevent' 'KEYCODE_POWER'"] },
    ]);
  });

  it("starts videos through ssh adb", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = new AdbYoutubeController(makeConfig("/tmp/show-manager"), async (command, args) => {
      calls.push({ command, args });
      return { stdout: "", stderr: "" };
    });

    await controller.playVideo("GF3wagWwHjM");

    expect(calls).toEqual([
      { command: "ssh", args: ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "rasp", remotePrefix + "'connect' '192.168.1.104:5555'"] },
      {
        command: "ssh",
        args: [
          "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "rasp",
          remotePrefix + "'-s' '192.168.1.104:5555' 'shell' 'am' 'start' '-a' 'android.intent.action.VIEW' '-d' 'https://www.youtube.com/watch?v=GF3wagWwHjM'",
        ],
      },
    ]);
  });
});
