import { readFile, rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import { runCommand } from "../server/src/services/run-command";
import { boundedAdbSource } from "../server/src/services/adb-youtube-controller";
import { makeTempPaths } from "./test-helpers";

// Real local children only; no SSH, ADB or network.
describe("command process teardown", () => {
  it.each(["abort", "timeout"] as const)("%s waits for SIGKILL/close, not just Promise rejection", async (mode) => {
    const paths = await makeTempPaths();
    const pidFile = `${paths.root}/child.pid`;
    const controller = new AbortController();
    try {
      const command = runCommand(process.execPath, ["-e", `
        require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
        process.on('SIGTERM', () => {});
        setInterval(() => {}, 1000);
      `], { signal: controller.signal, timeoutMs: mode === "timeout" ? 800 : 5000 });
      const rejected = expect(command).rejects.toThrow(mode === "timeout" ? "timed out" : "cancelled");
      let pid = 0;
      await vi.waitFor(async () => { pid = Number(await readFile(pidFile, "utf8")); expect(pid).toBeGreaterThan(0); });
      const started = performance.now();
      if (mode === "abort") controller.abort();
      await rejected;
      expect(performance.now() - started).toBeGreaterThan(200);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally { await rm(paths.root, { recursive: true, force: true }); }
  });

  it("exact remote Python watchdog survives hangup, kills and waits for a stuck command", async () => {
    const paths = await makeTempPaths();
    const childFile = `${paths.root}/adb-fixture.pid`;
    const wrapperFile = `${paths.root}/wrapper.pid`;
    try {
      const started = performance.now();
      const command = runCommand("python3", ["-c", `import os\nopen(${JSON.stringify(wrapperFile)}, 'w').write(str(os.getpid()))\n${boundedAdbSource}`, process.execPath, "-e", `
        require('node:fs').writeFileSync(${JSON.stringify(childFile)}, String(process.pid));
        process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);
      `], { timeoutMs: 7000 });
      const rejected = expect(command).rejects.toThrow("TimeoutExpired");
      let childPid = 0;
      await vi.waitFor(async () => { childPid = Number(await readFile(childFile, "utf8")); expect(childPid).toBeGreaterThan(0); });
      const wrapperPid = Number(await readFile(wrapperFile, "utf8"));
      process.kill(wrapperPid, "SIGHUP");
      await rejected;
      expect(performance.now() - started).toBeLessThan(6500);
      expect(() => process.kill(childPid, 0)).toThrow();
      expect(() => process.kill(wrapperPid, 0)).toThrow();
    } finally { await rm(paths.root, { recursive: true, force: true }); }
  }, 10_000);

  it("pre-aborted commands never spawn; ordinary results and failures remain intact", async () => {
    const controller = new AbortController(); controller.abort(new Error("fixture cancelled"));
    await expect(runCommand("must-not-spawn", [], { signal: controller.signal })).rejects.toThrow("fixture cancelled");
    await expect(runCommand(process.execPath, ["-e", "process.stdout.write('ok'); process.stderr.write('diagnostic');"])).resolves.toEqual({ stdout: "ok", stderr: "diagnostic" });
    await expect(runCommand(process.execPath, ["-e", "process.exit(4)"])).rejects.toThrow("exited with 4");
    await expect(runCommand("fixture-nonexistent-command", [])).rejects.toThrow();
  });
});
