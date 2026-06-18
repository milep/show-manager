import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PlaylistBundleService } from "../server/src/services/playlist-bundle";
import { ShowStateStore } from "../server/src/services/show-state-store";
import { makeDraft, makeTempPaths } from "./test-helpers";

describe("PlaylistBundleService", () => {
  it("builds deterministic playlist entries", async () => {
    const paths = await makeTempPaths();
    const store = new ShowStateStore(paths);
    const imagePath = `${paths.uploadsDir}/image-1`;
    const videoPath = `${paths.uploadsDir}/video-1`;
    await writeFile(`${imagePath}.jpg`, "img");
    await writeFile(`${videoPath}.mp4`, "vid");
    await store.saveLibrary({
      items: [
        { id: "video-1", kind: "video", originalFilename: "clip.mp4", extension: ".mp4", mimeType: "video/mp4", uploadedAt: new Date().toISOString(), sourcePath: `${videoPath}.mp4`, thumbnailPath: `${videoPath}.jpg`, thumbnailUrl: "/media/video-1/thumb.jpg", durationSeconds: 3, width: 1920, height: 1080 },
        { id: "image-1", kind: "image", originalFilename: "frame.jpg", extension: ".jpg", mimeType: "image/jpeg", uploadedAt: new Date().toISOString(), sourcePath: `${imagePath}.jpg`, thumbnailPath: `${imagePath}.jpg`, thumbnailUrl: "/media/image-1/thumb.jpg", durationSeconds: null, width: 800, height: 600 },
      ],
    });
    const bundleService = new PlaylistBundleService(paths);
    const bundle = await bundleService.build(
      makeDraft({
        playlist: [
          { id: "item-1", sourceMediaId: "image-1" },
          { id: "item-2", sourceMediaId: "video-1" },
        ],
      }),
      await store.getLibrary(),
    );

    const playlist = await readFile(bundle.playlistPath, "utf8");
    const launchScript = await readFile(bundle.launchScriptPath, "utf8");
    const script = await readFile(bundle.runScriptPath, "utf8");
    expect(playlist.trim().split("\n")).toEqual(["media/001-image-1.jpg", "media/002-video-1.mp4", "media/002-video-1.mp4"]);
    expect(launchScript).toContain("openvt -f -s -w -c 1 -- mpv --fs --no-terminal");
    expect(script).toContain('"$ROOT_DIR/launch-player.sh"');
  });
});
