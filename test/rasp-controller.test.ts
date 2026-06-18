import { describe, expect, it, vi } from "vitest";
import { RaspController, parseRemoteStatus } from "../server/src/services/rasp-controller";
import { ShowStateStore } from "../server/src/services/show-state-store";
import { makeConfig, makeTempPaths } from "./test-helpers";

describe("RaspController", () => {
  it("parses status output", () => {
    expect(parseRemoteStatus("state=running release=apply-1 pid=123 log=/tmp/player.log")).toMatchObject({
      state: "running",
      activeReleaseId: "apply-1",
      pid: 123,
    });
  });

  it("constructs ssh and scp commands", async () => {
    const paths = await makeTempPaths();
    const config = makeConfig(paths.root);
    const store = new ShowStateStore(paths);
    const run = vi.fn(async (_command: string, _args: string[]) => ({ stdout: "state=running release=apply-1 pid=123 log=/tmp/player.log", stderr: "" }));
    const controller = new RaspController(config, paths, store, run);
    await controller.applyBundle({ applyId: "apply-1", applyDir: "/tmp/bundle", mediaDir: "/tmp/bundle/media", playlistPath: "/tmp/bundle/playlist.txt", launchScriptPath: "/tmp/bundle/launch-player.sh", runScriptPath: "/tmp/bundle/run-show.sh", draftHash: "hash" });
    expect(run).toHaveBeenCalledWith("scp", ["-r", "/tmp/bundle/.", "rasp:/home/pi/show-player/releases/.incoming-apply-1/"]);
    expect(run).toHaveBeenCalledWith(
      "ssh",
      expect.arrayContaining([
        "rasp",
        expect.stringContaining("NR > 3"),
      ]),
    );
  });
});
