import { describe, expect, it, vi } from "vitest";
import { MediaStore } from "../server/src/services/media-store";
import { ShowStateStore } from "../server/src/services/show-state-store";
import { makeTempPaths } from "./test-helpers";

describe("MediaStore", () => {
  it("stores upload metadata", async () => {
    const paths = await makeTempPaths();
    const store = new ShowStateStore(paths);
    const thumbnails = {
      createThumbnail: vi.fn(async () => undefined),
      probe: vi.fn(async () => ({ durationSeconds: null, width: 800, height: 600 })),
    };
    const mediaStore = new MediaStore(paths, store, thumbnails as never);

    const item = await mediaStore.saveUpload({
      originalname: "frame.jpg",
      mimetype: "image/jpeg",
      size: 3,
      buffer: Buffer.from("abc"),
    } as Express.Multer.File);

    expect(item.kind).toBe("image");
    expect(item.thumbnailUrl).toMatch(/^\/media\//);
    await expect(store.getLibrary()).resolves.toMatchObject({ items: [expect.objectContaining({ id: item.id })] });
  });

  it("rejects unsupported extension", async () => {
    const paths = await makeTempPaths();
    const store = new ShowStateStore(paths);
    const mediaStore = new MediaStore(paths, store, {
      createThumbnail: vi.fn(),
      probe: vi.fn(),
    } as never);

    await expect(
      mediaStore.saveUpload({ originalname: "frame.txt", mimetype: "text/plain", size: 1, buffer: Buffer.from("x") } as Express.Multer.File),
    ).rejects.toThrow(/Unsupported/);
  });
});
