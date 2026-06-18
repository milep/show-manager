import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MediaAsset } from "../../../shared/show-schema.js";
import type { DataRootPaths } from "./data-root.js";
import type { ShowManagerConfig } from "../config.js";
import type { ShowStateStore } from "./show-state-store.js";
import { ThumbnailService } from "./thumbnail-service.js";

const extensionKinds = new Map<string, "image" | "video">([
  [".jpg", "image"],
  [".jpeg", "image"],
  [".png", "image"],
  [".webp", "image"],
  [".gif", "image"],
  [".mp4", "video"],
  [".mov", "video"],
  [".mkv", "video"],
  [".webm", "video"],
]);

export class MediaStore {
  constructor(
    private readonly paths: DataRootPaths,
    private readonly store: ShowStateStore,
    private readonly config: ShowManagerConfig,
    private readonly thumbnails: ThumbnailService,
  ) {}

  getAcceptedExtensions(): string[] {
    return [...extensionKinds.keys()];
  }

  async saveUpload(file: Express.Multer.File): Promise<MediaAsset> {
    const extension = path.extname(file.originalname).toLowerCase();
    const kind = extensionKinds.get(extension);
    if (!kind) {
      throw new Error(`Unsupported media extension: ${extension || "<none>"}`);
    }
    if (file.size > this.config.maxUploadBytes) {
      throw new Error(`Upload exceeds limit: ${this.config.maxUploadBytes}`);
    }

    const mediaId = randomUUID();
    const mediaDir = path.join(this.paths.uploadsDir, mediaId);
    const sourcePath = path.join(mediaDir, `source${extension}`);
    const thumbnailPath = path.join(mediaDir, "thumb.jpg");
    await mkdir(mediaDir, { recursive: true });
    await writeFile(sourcePath, file.buffer);
    await this.thumbnails.createThumbnail(sourcePath, thumbnailPath);
    const metadata = await this.thumbnails.probe(sourcePath);

    const item: MediaAsset = {
      id: mediaId,
      kind,
      originalFilename: file.originalname,
      extension,
      mimeType: file.mimetype || "application/octet-stream",
      uploadedAt: new Date().toISOString(),
      sourcePath,
      thumbnailPath,
      thumbnailUrl: `/media/${mediaId}/thumb.jpg`,
      durationSeconds: metadata.durationSeconds,
      width: metadata.width,
      height: metadata.height,
    };

    await this.store.addLibraryItem(item);
    return item;
  }
}
