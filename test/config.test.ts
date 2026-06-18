import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/src/config";

describe("loadConfig", () => {
  it("loads defaults", () => {
    const config = loadConfig({ NODE_ENV: "test" });
    expect(config.port).toBe(4791);
    expect(config.host).toBe("127.0.0.1");
    expect(config.publicBaseUrl).toBe("https://show.miikaleppanen.com");
    expect(config.raspReleasesToKeep).toBe(3);
  });

  it("rejects invalid port", () => {
    expect(() => loadConfig({ SHOW_MANAGER_PORT: "99999", NODE_ENV: "test" })).toThrow(/Invalid config/);
  });

  it("rejects invalid release retention", () => {
    expect(() => loadConfig({ SHOW_MANAGER_RASP_RELEASES_TO_KEEP: "0", NODE_ENV: "test" })).toThrow(/Invalid config/);
  });
});
