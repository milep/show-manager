import { spawn } from "node:child_process";

export type CommandResult = {
  stdout: string;
  stderr: string;
};

export type CommandOptions = { signal?: AbortSignal | undefined; timeoutMs?: number };
export type CommandRunner = (command: string, args: string[], options?: CommandOptions) => Promise<CommandResult>;

export const runCommand: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason);
      return;
    }
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    let kill: NodeJS.Timeout | undefined;
    const terminate = (error: Error) => {
      if (failure) return;
      failure = error;
      child.kill("SIGTERM");
      kill = setTimeout(() => child.kill("SIGKILL"), 250);
    };
    const abort = () => terminate(new Error("Command cancelled."));
    options.signal?.addEventListener("abort", abort, { once: true });
    const timeout = options.timeoutMs === undefined ? undefined : setTimeout(
      () => terminate(new Error(`${command} timed out.`)), options.timeoutMs,
    );
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (kill) clearTimeout(kill);
      options.signal?.removeEventListener("abort", abort);
    };
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => { failure = error; });
    // Reject only after close: callers cannot advance while a cancelled child lives.
    child.on("close", (code) => {
      cleanup();
      if (failure) reject(failure);
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code}. ${stderr.trim()}`));
    });
  });
