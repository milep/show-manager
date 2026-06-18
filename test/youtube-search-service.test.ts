import { describe, expect, it } from "vitest";
import { normalizeSong, normalizeVideo, YoutubeSearchService, type YTMusicClient } from "../server/src/services/youtube-search-service";

function emptyClient(overrides: Partial<YTMusicClient> = {}): YTMusicClient {
  return {
    initialize: async () => undefined,
    searchSongs: async () => [],
    searchVideos: async () => [],
    getSearchSuggestions: async () => [],
    ...overrides,
  };
}

describe("YoutubeSearchService", () => {
  it("normalizes songs and videos", async () => {
    const song = normalizeSong({
      type: "SONG",
      videoId: "GF3wagWwHjM",
      name: "Teardrop",
      artist: { artistId: null, name: "Massive Attack" },
      album: { albumId: "album-1", name: "Mezzanine" },
      duration: 330,
      thumbnails: [{ url: "https://example.com/song.jpg", width: 120, height: 120 }],
    });
    const video = normalizeVideo({
      type: "VIDEO",
      videoId: "Kdg4DLAPC4A",
      name: "Teardrop Official Video",
      artist: { artistId: null, name: "Massive Attack" },
      duration: 320,
      thumbnails: [{ url: "https://example.com/video.jpg", width: 120, height: 120 }],
    });

    expect(song).toMatchObject({ kind: "song", title: "Teardrop", artists: ["Massive Attack"], album: "Mezzanine", duration: "5:30" });
    expect(video).toMatchObject({ kind: "video", title: "Teardrop Official Video", artists: ["Massive Attack"], album: null, duration: "5:20" });
  });

  it("returns empty results when both branches succeed empty", async () => {
    const service = new YoutubeSearchService(emptyClient());

    const response = await service.search("nothing much");

    expect(response).toEqual({ results: [], warnings: [] });
  });

  it("returns partial results when one branch fails", async () => {
    const client = emptyClient({
      searchSongs: async () => {
        throw new Error("songs failed");
      },
      searchVideos: async () => [
        {
          type: "VIDEO",
          videoId: "Kdg4DLAPC4A",
          name: "Video",
          artist: { artistId: null, name: "Channel" },
          duration: null,
          thumbnails: [],
        },
      ],
    });
    const service = new YoutubeSearchService(client);

    const response = await service.search("massive attack");

    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.kind).toBe("video");
    expect(response.warnings[0]).toContain("song search failed");
  });

  it("returns suggestions", async () => {
    const service = new YoutubeSearchService(emptyClient({
      getSearchSuggestions: async (query: string) => [`${query} one`, `${query} two`],
    }));

    await expect(service.suggestions("tear")).resolves.toEqual({ suggestions: ["tear one", "tear two"] });
  });

  it("resets failed initialization", async () => {
    let initializeCalls = 0;
    const service = new YoutubeSearchService(emptyClient({
      initialize: async () => {
        initializeCalls += 1;
        if (initializeCalls === 1) throw new Error("init failed");
      },
    }));

    await expect(service.search("first")).rejects.toThrow("init failed");
    await expect(service.search("second")).resolves.toEqual({ results: [], warnings: [] });
    expect(initializeCalls).toBe(2);
  });
});
