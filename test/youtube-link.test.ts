import { describe, expect, it } from "vitest";
import { parseYoutubeLink } from "../server/src/services/youtube-link";

describe("parseYoutubeLink", () => {
  it("parses short links", () => {
    expect(parseYoutubeLink("https://youtu.be/GF3wagWwHjM?si=x")).toEqual({
      videoId: "GF3wagWwHjM",
      canonicalUrl: "https://www.youtube.com/watch?v=GF3wagWwHjM",
    });
  });

  it("parses watch links", () => {
    expect(parseYoutubeLink("https://www.youtube.com/watch?v=Kdg4DLAPC4A").videoId).toBe("Kdg4DLAPC4A");
  });

  it("rejects invalid links", () => {
    expect(() => parseYoutubeLink("https://example.com/watch?v=Kdg4DLAPC4A")).toThrow("YouTube link");
  });
});
