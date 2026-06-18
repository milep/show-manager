import { describe, expect, it, vi } from "vitest";
import { ThumbnailService } from "../server/src/services/thumbnail-service";

describe("ThumbnailService", () => {
  it("creates thumbnails through ffmpeg", async () => {
    const run = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const service = new ThumbnailService(run);
    await service.createThumbnail("/tmp/source.mp4", "/tmp/thumb.jpg");
    expect(run).toHaveBeenCalledWith("ffmpeg", expect.arrayContaining(["-i", "/tmp/source.mp4", "/tmp/thumb.jpg"]));
  });

  it("parses ffprobe metadata", async () => {
    const run = vi.fn(async () => ({
      stdout: JSON.stringify({ format: { duration: "7.5" }, streams: [{ codec_type: "video", width: 1920, height: 1080 }] }),
      stderr: "",
    }));
    const service = new ThumbnailService(run);
    await expect(service.probe("/tmp/source.mp4")).resolves.toEqual({ durationSeconds: 7.5, width: 1920, height: 1080 });
  });
});
