import type Database from "better-sqlite3";
import { z } from "zod";
import { youtubeVideoIdSchema } from "../../../shared/show-schema.js";
import { YoutubeTitleService } from "./youtube-title-service.js";
import { ensureYoutubeTitleColumns, readYoutubeTitle, saveYoutubeTitle } from "./youtube-title-storage.js";

export const youtubeTitleCleanupBatchSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  refreshVideoIds: z.array(youtubeVideoIdSchema).max(100).default([]),
}).refine((value) => new Set(value.refreshVideoIds).size <= value.limit, "Refresh IDs must fit in one batch.");

export type YoutubeTitleCleanupSummary = {
  selected: number; processed: number; cleaned: number; refreshed: number;
  skippedSuccessful: number; fetchedMissing: number; failed: number; notFound: number; interrupted: boolean;
};

type CleanupOptions = {
  limit?: number;
  refreshVideoIds?: string[];
  signal?: AbortSignal;
  onProgress?: (summary: YoutubeTitleCleanupSummary) => void;
};

export async function cleanupYoutubeTitles(db: Database.Database, options: CleanupOptions = {}, fetchImpl: typeof fetch = fetch, key?: () => string | null) {
  const batch = youtubeTitleCleanupBatchSchema.parse(options);
  const refreshIds = [...new Set(batch.refreshVideoIds)];
  ensureYoutubeTitleColumns(db);
  const service = new YoutubeTitleService({
    getVideoTitle: (id) => readYoutubeTitle(db, id),
    saveVideoTitle: (id, title, saveOptions) => saveYoutubeTitle(db, id, title, saveOptions),
  }, fetchImpl, key);
  const rows = refreshIds.length
    ? db.prepare(`
        select source_id as video_id from youtube_media where source_id in (${refreshIds.map(() => "?").join(",")})
        union select video_id from youtube_confirmed_videos where video_id in (${refreshIds.map(() => "?").join(",")})
        order by video_id limit ?
      `).all(...refreshIds, ...refreshIds, batch.limit) as Array<{ video_id: string }>
    : db.prepare(`
        with videos as (
          select source_id as video_id from youtube_media
          union select video_id from youtube_confirmed_videos
        ), active as (
          select m.source_id as video_id, min(case when q.status = 'playing' then 0 else 1 end) as priority, min(q.position) as position
          from youtube_party_queue_items q join youtube_media m on m.id = q.media_item_id
          where q.status in ('playing', 'pending') group by m.source_id
        )
        select v.video_id from videos v left join active a on a.video_id = v.video_id
        order by coalesce(a.priority, 2), a.position, v.video_id
      `).all() as Array<{ video_id: string }>;
  // Use the same validity rule as preparation/writes; local reads do not consume the paid batch.
  const selected = [];
  for (const row of rows) {
    if (refreshIds.length || readYoutubeTitle(db, row.video_id).needsCleanup) selected.push(row);
    if (selected.length === batch.limit) break;
  }
  const summary: YoutubeTitleCleanupSummary = {
    selected: selected.length, processed: 0, cleaned: 0, refreshed: 0, skippedSuccessful: 0,
    fetchedMissing: 0, failed: 0, notFound: refreshIds.length ? refreshIds.length - selected.length : 0, interrupted: false,
  };
  let lastProgress = -1;
  const progress = () => { options.onProgress?.({ ...summary }); lastProgress = summary.processed; };
  progress();
  for (const row of selected) {
    if (options.signal?.aborted) { summary.interrupted = true; break; }
    const stored = readYoutubeTitle(db, row.video_id);
    if (!stored.needsCleanup && !refreshIds.length) {
      // Another addition may have completed this ID after batch selection.
      saveYoutubeTitle(db, row.video_id, stored);
      summary.skippedSuccessful += 1;
    } else {
      try {
        const result = await service.prepare({ sourceId: row.video_id, url: `https://www.youtube.com/watch?v=${row.video_id}` }, {
          refreshDisplay: refreshIds.length > 0, ...(options.signal ? { signal: options.signal } : {}),
        });
        if (!stored.title && result.title) summary.fetchedMissing += 1;
        if (result.displayTitle) {
          summary.cleaned += 1;
          if ((refreshIds.length && stored.displayTitle) || stored.incompleteDisplay) summary.refreshed += 1;
        } else summary.failed += 1;
      } catch (error) {
        if (!options.signal?.aborted) throw error;
        summary.interrupted = true;
        break;
      }
    }
    summary.processed += 1;
    if (summary.processed === 1 || summary.processed % 5 === 0 || summary.processed === summary.selected) progress();
  }
  if (lastProgress !== summary.processed || summary.interrupted) progress();
  return summary;
}
