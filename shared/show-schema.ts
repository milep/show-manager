import { z } from "zod";

export const mediaKindSchema = z.enum(["image", "video"]);

export const mediaAssetSchema = z.object({
  id: z.string().min(1),
  kind: mediaKindSchema,
  originalFilename: z.string().min(1),
  extension: z.string().min(1),
  mimeType: z.string().min(1),
  uploadedAt: z.string().datetime(),
  sourcePath: z.string().min(1),
  thumbnailPath: z.string().min(1),
  thumbnailUrl: z.string().min(1),
  durationSeconds: z.number().nonnegative().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});

export const libraryStateSchema = z.object({
  items: z.array(mediaAssetSchema),
});

export const showSettingsSchema = z.object({
  imageDurationSeconds: z.number().int().min(1).max(3600),
  videoLoopCount: z.number().int().min(1).max(100),
});

export const playlistItemSchema = z.object({
  id: z.string().min(1),
  sourceMediaId: z.string().min(1),
});

export const draftShowSchema = z.object({
  playlist: z.array(playlistItemSchema),
  settings: showSettingsSchema,
});

export const remoteStatusSchema = z.object({
  state: z.enum(["unknown", "running", "stopped", "error"]),
  activeReleaseId: z.string().nullable(),
  pid: z.number().int().positive().nullable(),
  logPath: z.string().nullable(),
  checkedAt: z.string().datetime(),
  detail: z.string().nullable(),
});

export const lastAppliedSchema = z.object({
  applyId: z.string().min(1),
  draftHash: z.string().min(1),
  appliedAt: z.string().datetime(),
  remoteStatus: remoteStatusSchema,
  stderr: z.string().nullable(),
});

export const qrDisplayStatusSchema = z.object({
  active: z.boolean(),
  publicUrl: z.string().url().nullable(),
});

export const accessModeSchema = z.object({
  access: z.enum(["public", "trusted"]),
});

export const apiStatusSchema = z.object({
  draftHash: z.string().min(1),
  isDirty: z.boolean(),
  draft: draftShowSchema,
  lastApplied: lastAppliedSchema.nullable(),
  remoteStatus: remoteStatusSchema,
  applyInProgress: z.boolean(),
});

export type MediaAsset = z.infer<typeof mediaAssetSchema>;
export type LibraryState = z.infer<typeof libraryStateSchema>;
export type ShowSettings = z.infer<typeof showSettingsSchema>;
export type PlaylistItem = z.infer<typeof playlistItemSchema>;
export type DraftShow = z.infer<typeof draftShowSchema>;
export type RemoteStatus = z.infer<typeof remoteStatusSchema>;
export type LastApplied = z.infer<typeof lastAppliedSchema>;
export type QrDisplayStatus = z.infer<typeof qrDisplayStatusSchema>;
export type AccessMode = z.infer<typeof accessModeSchema>;
export type ApiStatus = z.infer<typeof apiStatusSchema>;

export const defaultDraftShow: DraftShow = {
  playlist: [],
  settings: {
    imageDurationSeconds: 8,
    videoLoopCount: 2,
  },
};
