import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("show-player.service", () => {
  it("starts the active slideshow once without crash recovery", async () => {
    const unit = await readFile("deploy/systemd/show-player.service", "utf8");

    expect(unit).toContain("ExecStart=/usr/bin/env bash /home/pi/show-player/active/launch-player.sh");
    expect(unit).toContain("Restart=no");
    expect(unit).toContain("WantedBy=multi-user.target");
  });
});
