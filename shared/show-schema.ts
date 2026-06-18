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

export const youtubeMediaKindSchema = z.enum(["video", "music", "unknown"]);

export const youtubeMediaItemSchema = z.object({
  id: z.string().min(1),
  source: z.literal("youtube"),
  sourceId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  url: z.string().url(),
  kind: youtubeMediaKindSchema,
  title: z.string().min(1).nullable(),
  artist: z.string().min(1).nullable(),
  album: z.string().min(1).nullable(),
  channel: z.string().min(1).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  thumbnailUrl: z.string().url().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const youtubePlaylistSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const youtubeSearchResultSchema = z.object({
  kind: z.enum(["song", "video"]),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string().min(1),
  artists: z.array(z.string().min(1)),
  album: z.string().min(1).nullable(),
  duration: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  thumbnails: z.array(z.string().url()),
});

export const youtubeSearchResponseSchema = z.object({
  results: z.array(youtubeSearchResultSchema),
  warnings: z.array(z.string()),
});

export const youtubeSearchSuggestionsResponseSchema = z.object({
  suggestions: z.array(z.string().min(1)),
});

export const youtubeQueueItemSchema = z.object({
  id: z.string().min(1),
  mediaItemId: z.string().min(1),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  url: z.string().url(),
  title: z.string().min(1).nullable(),
  artist: z.string().min(1).nullable(),
  album: z.string().min(1).nullable(),
  channel: z.string().min(1).nullable(),
  subtitle: z.string().min(1).nullable(),
  addedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});

export const youtubeQueueStateSchema = z.object({
  items: z.array(youtubeQueueItemSchema),
  currentItemId: z.string().min(1).nullable(),
  updatedAt: z.string().datetime(),
});

export const youtubePlaybackStatusSchema = z.object({
  connected: z.boolean(),
  state: z.enum(["unknown", "idle", "playing", "paused", "buffering", "ended", "error"]),
  packageName: z.string().nullable(),
  videoId: z.string().nullable(),
  title: z.string().nullable(),
  subtitle: z.string().nullable(),
  album: z.string().nullable(),
  positionMs: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  checkedAt: z.string().datetime(),
  detail: z.string().nullable(),
});

export const youtubeSchedulerStatusSchema = z.object({
  enabled: z.boolean(),
  lastTickAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
});

export const youtubeQueueSnapshotSchema = z.object({
  queue: youtubeQueueStateSchema,
  playback: youtubePlaybackStatusSchema,
  scheduler: youtubeSchedulerStatusSchema,
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
export type YoutubeMediaKind = z.infer<typeof youtubeMediaKindSchema>;
export type YoutubeMediaItem = z.infer<typeof youtubeMediaItemSchema>;
export type YoutubePlaylist = z.infer<typeof youtubePlaylistSchema>;
export type YoutubeSearchResult = z.infer<typeof youtubeSearchResultSchema>;
export type YoutubeSearchResponse = z.infer<typeof youtubeSearchResponseSchema>;
export type YoutubeSearchSuggestionsResponse = z.infer<typeof youtubeSearchSuggestionsResponseSchema>;
export type YoutubeQueueItem = z.infer<typeof youtubeQueueItemSchema>;
export type YoutubeQueueState = z.infer<typeof youtubeQueueStateSchema>;
export type YoutubePlaybackStatus = z.infer<typeof youtubePlaybackStatusSchema>;
export type YoutubeSchedulerStatus = z.infer<typeof youtubeSchedulerStatusSchema>;
export type YoutubeQueueSnapshot = z.infer<typeof youtubeQueueSnapshotSchema>;
export type ApiStatus = z.infer<typeof apiStatusSchema>;

export const defaultDraftShow: DraftShow = {
  playlist: [],
  settings: {
    imageDurationSeconds: 8,
    videoLoopCount: 2,
  },
};
