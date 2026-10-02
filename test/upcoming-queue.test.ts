import { createElement, type ComponentProps, type MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { YoutubeQueueItem, YoutubeQueueState } from "../shared/show-schema";
import { UpcomingQueue } from "../web/src/components/upcoming-queue";
import type { Button } from "../web/src/components/ui/button";

const { buttons } = vi.hoisted(() => ({ buttons: [] as ComponentProps<typeof Button>[] }));
vi.mock("@/components/ui/button", async (importOriginal) => {
  const original = await importOriginal<typeof import("../web/src/components/ui/button")>();
  return {
    ...original,
    Button: (props: ComponentProps<typeof Button>) => {
      buttons.push(props);
      return createElement(original.Button, props);
    },
  };
});

function item(id: string): YoutubeQueueItem {
  return {
    id, mediaItemId: "shared-source", videoId: "GF3wagWwHjM", url: "https://www.youtube.com/watch?v=GF3wagWwHjM",
    title: "Same title", artist: "Artist", album: "Album", channel: null, subtitle: "Artist",
    addedAt: "2026-01-01T00:00:00.000Z", startedAt: null, completedAt: null,
  };
}

function render(items: YoutubeQueueItem[], currentItemId: string | null = null, busy = false) {
  const onRemove = vi.fn();
  const onMove = vi.fn();
  const queue: YoutubeQueueState = { items, currentItemId, updatedAt: "2026-01-01T00:00:00.000Z" };
  const html = renderToStaticMarkup(createElement(UpcomingQueue, { queue, busy, onRemove, onMove }));
  return { html, onRemove, onMove };
}

beforeEach(() => { buttons.length = 0; });

describe("Upcoming queue controls", () => {
  it("renders accessible entry-specific actions, disables boundaries, and excludes Now Playing", () => {
    const { html, onMove, onRemove } = render([item("playing"), item("first"), item("middle"), item("last")], "playing");
    expect(buttons).toHaveLength(9);
    expect(buttons.map((button) => button.disabled)).toEqual([true, false, false, false, false, false, false, true, false]);
    expect(buttons.every((button) => button.type === "button")).toBe(true);
    expect(buttons[0]?.["aria-label"]).toBe("Move up upcoming item 1: Artist - Same title");
    expect(buttons[8]?.["aria-label"]).toBe("Remove upcoming item 3: Artist - Same title");
    expect(html.match(/<button/g)).toHaveLength(9);
    expect(buttons.map((button) => button.variant)).toEqual([
      "secondary", "secondary", "destructive",
      "secondary", "secondary", "destructive",
      "secondary", "secondary", "destructive",
    ]);
    expect(html).toContain('data-variant="destructive"');
    expect(html).toContain("Album");
    expect(buttons.every((button) => button.size === "icon" && button.className === "size-11")).toBe(true);
    expect(html.match(/<svg/g)).toHaveLength(9);
    expect(html).toContain("lucide-arrow-up");
    expect(html).toContain("lucide-arrow-down");
    expect(html).toContain("lucide-trash");
    expect(html).not.toMatch(/>\s*(Move up|Move down|Remove)\s*</);
    expect(html).toContain('class="flex items-center gap-2"');
    expect(html).toContain('class="line-clamp-2 break-words font-medium"');
    expect(html).toContain('class="flex shrink-0 gap-1"');
    expect(html).toContain('class="min-w-0 flex-1"');
    expect(html).toContain('title="Artist - Same title"');
    const event = {} as MouseEvent<HTMLButtonElement>;
    buttons[3]?.onClick?.(event);
    buttons[4]?.onClick?.(event);
    buttons[5]?.onClick?.(event);
    expect(onMove.mock.calls).toEqual([["middle", "up"], ["middle", "down"]]);
    expect(onRemove.mock.calls).toEqual([["middle"]]);
  });

  it("preserves long titles and optional album metadata while limiting title layout to two lines", () => {
    const longTitle = "UnbrokenTitle".repeat(30);
    const { html } = render([{ ...item("long"), title: longTitle }, { ...item("short"), title: "Short", album: null }]);
    expect(html).toContain(`title="Artist - ${longTitle}"`);
    expect(html.match(/class="line-clamp-2 break-words font-medium"/g)).toHaveLength(2);
    expect(html.match(/class="flex items-center gap-2"/g)).toHaveLength(2);
    expect(html.match(/class="truncate text-xs text-muted-foreground"/g)).toHaveLength(1);
  });

  it("disables both moves for a single upcoming entry but allows removal", () => {
    const { html } = render([item("only")]);
    expect(buttons.map((button) => button.disabled)).toEqual([true, true, false]);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("disables all edits while a mutation is pending", () => {
    render([item("one"), item("two")], null, true);
    expect(buttons).toHaveLength(6);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  it("renders no actions for an empty queue or only Now Playing", () => {
    expect(render([]).html).toContain("Queue is empty.");
    expect(render([item("playing")], "playing").html).toContain("Queue is empty.");
    expect(buttons).toHaveLength(0);
  });
});
