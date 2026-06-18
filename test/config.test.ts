import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/src/config";

describe("loadConfig", () => {
  it("loads defaults", () => {
    const config = loadConfig({});
    expect(config.port).toBe(4791);
    expect(config.host).toBe("127.0.0.1");
    expect(config.raspSshTarget).toBe("rasp");
    expect(config.publicBaseUrl).toBe("https://show.miikaleppanen.com");
    expect(config.youtubeDataApiKey).toBeNull();
  });

  it("loads YouTube Data API key", () => {
    const config = loadConfig({ YOUTUBE_DATA_API_KEY: "test-key" });
    expect(config.youtubeDataApiKey).toBe("test-key");
  });

  it("rejects invalid port", () => {
    expect(() => loadConfig({ SHOW_MANAGER_PORT: "99999" })).toThrow(/Invalid config/);
  });

  it("rejects invalid public URL", () => {
    expect(() => loadConfig({ SHOW_MANAGER_PUBLIC_BASE_URL: "not-a-url" })).toThrow(/Invalid config/);
  });
});
