import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { YoutubeQueueSnapshot } from "../shared/show-schema";
import { PlaylistManagerMock } from "../web/src/components/playlist-manager-mock";

const state = vi.hoisted(() => ({ snapshot: null as YoutubeQueueSnapshot | null, calls: 0 }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => react.useState(state.calls++ === 0 ? state.snapshot : initial) };
});

function snapshot(managed: boolean): YoutubeQueueSnapshot {
  return {
    queue: {
      currentItemId: managed ? "playing" : null, updatedAt: "2026-01-01T00:00:00.000Z",
      items: managed ? [{ id: "playing", mediaItemId: "media", videoId: "GF3wagWwHjM", url: "https://youtu.be/GF3wagWwHjM", title: "Label - Artist - Song (OFFICIAL VIDEO)", displayTitle: "Artist - Song", artist: "Artist", channel: "Label", subtitle: "Artist", album: null, addedAt: "2026-01-01T00:00:00.000Z", startedAt: "2026-01-01T00:00:00.000Z", completedAt: null }] : [],
    },
    playback: { connected: true, state: "playing", packageName: null, videoId: null, title: "Raw TV title", subtitle: "TV channel", album: null, positionMs: null, durationMs: null, checkedAt: "2026-01-01T00:00:00.000Z", detail: null },
    scheduler: { enabled: false, lastTickAt: null, lastError: null },
  };
}
beforeEach(() => { state.calls = 0; });
describe("Now Playing title copy (isolated server-rendered UI)", () => {
  it("uses the managed cleaned title once and hides redundant TV artist/channel", () => {
    state.snapshot = snapshot(true);
    const html = renderToStaticMarkup(createElement(PlaylistManagerMock, { showBackLink: false }));
    expect(html.match(/>Artist - Song</g)).toHaveLength(1);
    expect(html).not.toContain("Raw TV title");
    expect(html).not.toContain("TV channel");
    expect(html).not.toContain("OFFICIAL VIDEO");
  });
  it("keeps structured artist fallback for managed playback without a display title", () => {
    state.snapshot = snapshot(true);
    const item = state.snapshot.queue.items[0]!;
    item.title = "Song"; item.displayTitle = null; item.channel = "Record Label";
    const html = renderToStaticMarkup(createElement(PlaylistManagerMock, { showBackLink: false }));
    expect(html).toContain(">Artist - Song<");
    expect(html).not.toContain("Record Label");
    expect(html).not.toContain("TV channel");
  });
  it("preserves unmanaged raw TV fallback with no automatic provider call", () => {
    state.snapshot = snapshot(false);
    const html = renderToStaticMarkup(createElement(PlaylistManagerMock, { showBackLink: false }));
    expect(html).toContain(">Raw TV title<");
    expect(html).toContain(">TV channel<");
  });
});
