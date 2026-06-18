import { describe, expect, it } from "vitest";
import { AdbYoutubeController, parseYoutubePlaybackStatus } from "../server/src/services/adb-youtube-controller";
import { makeConfig } from "./test-helpers";

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
    expect(status.positionMs).toBe(433);
  });

  it("ignores missing native YouTube session", () => {
    const status = parseYoutubePlaybackStatus("package=com.google.android.apps.mediashell");
    expect(status.state).toBe("idle");
  });
});

describe("AdbYoutubeController", () => {
  it("starts videos through ssh adb", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = new AdbYoutubeController(makeConfig("/tmp/show-manager"), async (command, args) => {
      calls.push({ command, args });
      return { stdout: "", stderr: "" };
    });

    await controller.playVideo("GF3wagWwHjM");

    expect(calls).toEqual([
      { command: "ssh", args: ["rasp", "adb 'connect' '192.168.68.104:5555'"] },
      {
        command: "ssh",
        args: [
          "rasp",
          "adb 'shell' 'am' 'start' '-a' 'android.intent.action.VIEW' '-d' 'https://www.youtube.com/watch?v=GF3wagWwHjM'",
        ],
      },
    ]);
  });
});
