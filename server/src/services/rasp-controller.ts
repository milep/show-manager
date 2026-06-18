import { appendFile, writeFile } from "node:fs/promises";
import type { LastApplied, RemoteStatus } from "../../../shared/show-schema.js";
import { RASP_ACTIVE_ROOT, RASP_RELEASES_TO_KEEP, type ShowManagerConfig } from "../config.js";
import type { DataRootPaths } from "./data-root.js";
import type { BuiltBundle } from "./playlist-bundle.js";
import { renderQrGif } from "./qr-code.js";
import { runCommand, type CommandRunner } from "./run-command.js";
import type { ShowStateStore } from "./show-state-store.js";

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function regexEscape(value: string): string {
  return value.replace(/[\\.^$*+?()[\]{}|]/g, "\\$&");
}

export function parseRemoteStatus(output: string): RemoteStatus {
  const fields = new Map<string, string>();
  for (const chunk of output.trim().split(/\s+/)) {
    const [key, value = ""] = chunk.split("=");
    if (key) {
      fields.set(key, value);
    }
  }
  const state = fields.get("state");
  return {
    state: state === "running" || state === "stopped" || state === "error" ? state : "unknown",
    activeReleaseId: fields.get("release") || null,
    pid: fields.get("pid") ? Number(fields.get("pid")) : null,
    logPath: fields.get("log") || null,
    checkedAt: new Date().toISOString(),
    detail: output.trim() || null,
  };
}

export class RaspController {
  constructor(
    private readonly config: ShowManagerConfig,
    private readonly paths: DataRootPaths,
    private readonly store: ShowStateStore,
    private readonly run: CommandRunner = runCommand,
  ) {}

  private runRemoteShell(script: string) {
    return this.run("ssh", [this.config.raspSshTarget, `bash -lc ${shellEscape(script)}`]);
  }

  private playerPidFile() {
    return `${RASP_ACTIVE_ROOT}/player.pid`;
  }

  private playerLogFile() {
    return `${RASP_ACTIVE_ROOT}/player.log`;
  }

  private remoteQrPath() {
    return `${RASP_ACTIVE_ROOT}/qr-login.gif`;
  }

  private stopRemotePlayersScript() {
    const rootPattern = regexEscape(RASP_ACTIVE_ROOT);
    return `sudo pkill -f ${shellEscape(`[m]pv .*${rootPattern}`)} || true; sudo pkill -f ${shellEscape(`[o]penvt .*${rootPattern}`)} || true; rm -f ${shellEscape(this.playerPidFile())}`;
  }

  async status(): Promise<RemoteStatus> {
    try {
      const result = await this.run("ssh", [this.config.raspSshTarget, `${RASP_ACTIVE_ROOT}/active/run-show.sh`, "status"]);
      return parseRemoteStatus(result.stdout);
    } catch (error) {
      return {
        state: "unknown",
        activeReleaseId: null,
        pid: null,
        logPath: null,
        checkedAt: new Date().toISOString(),
        detail: error instanceof Error ? error.message : "status failed",
      };
    }
  }

  async showQrCode(url: string) {
    const remoteQrPath = this.remoteQrPath();
    const activeRunScript = `${RASP_ACTIVE_ROOT}/active/run-show.sh`;
    await writeFile(this.paths.qrImageFile, renderQrGif(url));
    await this.runRemoteShell(`mkdir -p ${shellEscape(RASP_ACTIVE_ROOT)}`);
    await this.run("scp", [this.paths.qrImageFile, `${this.config.raspSshTarget}:${remoteQrPath}`]);
    await this.runRemoteShell(`if [[ -x ${shellEscape(activeRunScript)} ]]; then ${shellEscape(activeRunScript)} stop || true; fi; ${this.stopRemotePlayersScript()}`);
    await this.runRemoteShell(
      `sudo rm -f ${shellEscape(this.playerLogFile())} ${shellEscape(this.playerPidFile())}; touch ${shellEscape(this.playerLogFile())}; nohup sudo openvt -f -s -w -c 1 -- mpv --fs --no-terminal --really-quiet --loop-file=inf --image-display-duration=inf ${shellEscape(remoteQrPath)} >> ${shellEscape(this.playerLogFile())} 2>&1 & echo $! > ${shellEscape(this.playerPidFile())}`,
    );
  }

  async hideQrCode() {
    const activeRunScript = `${RASP_ACTIVE_ROOT}/active/run-show.sh`;
    await this.runRemoteShell(this.stopRemotePlayersScript());
    await this.runRemoteShell(`if [[ -x ${shellEscape(activeRunScript)} ]]; then ${shellEscape(activeRunScript)} start; fi`);
  }

  async applyBundle(bundle: BuiltBundle): Promise<LastApplied> {
    const releasesRoot = `${RASP_ACTIVE_ROOT}/releases`;
    const incomingRoot = `${releasesRoot}/.incoming-${bundle.applyId}`;
    const activeRunScript = `${RASP_ACTIVE_ROOT}/active/run-show.sh`;
    const nextReleaseRoot = `${releasesRoot}/${bundle.applyId}`;
    await this.runRemoteShell(`mkdir -p ${shellEscape(releasesRoot)} ${shellEscape(RASP_ACTIVE_ROOT)}`);
    await this.runRemoteShell(`rm -rf ${shellEscape(incomingRoot)} && mkdir -p ${shellEscape(incomingRoot)}`);
    const scpResult = await this.run("scp", ["-r", `${bundle.applyDir}/.`, `${this.config.raspSshTarget}:${incomingRoot}/`]);
    const pruneCommand = `find ${shellEscape(releasesRoot)} -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' | sort -r | awk 'NR > ${RASP_RELEASES_TO_KEEP} { print }' | while IFS= read -r old_release; do [[ -n "$old_release" ]] || continue; rm -rf ${shellEscape(`${releasesRoot}/`)}"$old_release"; done`;
    const switchResult = await this.runRemoteShell(
      `if [[ -x ${shellEscape(activeRunScript)} ]]; then ${shellEscape(activeRunScript)} stop || true; fi && rm -rf ${shellEscape(nextReleaseRoot)} && mv ${shellEscape(incomingRoot)} ${shellEscape(nextReleaseRoot)} && ln -sfn ${shellEscape(nextReleaseRoot)} ${shellEscape(`${RASP_ACTIVE_ROOT}/active`)} && ${shellEscape(activeRunScript)} start && ${pruneCommand}`,
    );
    const remoteStatus = parseRemoteStatus(switchResult.stdout);
    const lastApplied: LastApplied = {
      applyId: bundle.applyId,
      draftHash: bundle.draftHash,
      appliedAt: new Date().toISOString(),
      remoteStatus,
      stderr: [scpResult.stderr.trim(), switchResult.stderr.trim()].filter(Boolean).join("\n") || null,
    };
    await this.store.saveLastApplied(lastApplied);
    await appendFile(this.paths.applyHistoryFile, `${JSON.stringify(lastApplied)}\n`, "utf8");
    return lastApplied;
  }
}
