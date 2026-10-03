import { ArrowDown, ArrowUp, Trash } from "lucide-react";
import type { YoutubeQueueItem, YoutubeQueueState } from "../../../shared/show-schema";
import { Button } from "@/components/ui/button";

export function queueTitle(item: YoutubeQueueItem) {
  if (item.displayTitle) return item.displayTitle;
  if (!item.title) return item.videoId;
  const artist = item.artist?.trim();
  if (artist && !item.title.toLocaleLowerCase().startsWith(`${artist.toLocaleLowerCase()} - `)) return `${artist} - ${item.title}`;
  return item.title;
}

type UpcomingQueueProps = {
  queue: YoutubeQueueState;
  busy: boolean;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
};

export function UpcomingQueue({ queue, busy, onRemove, onMove }: UpcomingQueueProps) {
  const items = queue.items.filter((item) => item.id !== queue.currentItemId);
  if (!items.length) return <p className="text-sm text-muted-foreground">Queue is empty.</p>;

  return (
    <ol className="flex list-decimal flex-col gap-3 pl-5">
      {items.map((item, index) => {
        const title = queueTitle(item);
        const label = `upcoming item ${index + 1}: ${title}`;
        return (
          <li key={item.id} className="text-sm">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 break-words font-medium" title={title}>{title}</div>
                {item.album ? <div className="truncate text-xs text-muted-foreground" title={item.album}>{item.album}</div> : null}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button type="button" size="icon" className="size-11" variant="secondary" aria-label={`Move up ${label}`} disabled={busy || index === 0} onClick={() => onMove(item.id, "up")}>
                  <ArrowUp data-icon="inline-start" aria-hidden="true" />
                </Button>
                <Button type="button" size="icon" className="size-11" variant="secondary" aria-label={`Move down ${label}`} disabled={busy || index === items.length - 1} onClick={() => onMove(item.id, "down")}>
                  <ArrowDown data-icon="inline-start" aria-hidden="true" />
                </Button>
                <Button type="button" size="icon" className="size-11" variant="destructive" aria-label={`Remove ${label}`} disabled={busy} onClick={() => onRemove(item.id)}>
                  <Trash data-icon="inline-start" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
