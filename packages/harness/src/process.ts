import { spawnSync } from "node:child_process";

export type ToolRun =
  | { readonly kind: "not-found"; readonly command: string }
  | {
      readonly kind: "exited";
      readonly code: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | {
      readonly kind: "killed";
      readonly signal: NodeJS.Signals;
      /** Set when the harness killed it for running past its deadline. */
      readonly timedOutAfterMs: number | null;
      readonly stdout: string;
      readonly stderr: string;
    };

const DEFAULT_TIMEOUT_MS = 60_000;

export function runTool(
  command: string,
  args: readonly string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): ToolRun {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  if (result.signal !== null)
    return {
      kind: "killed",
      signal: result.signal,
      timedOutAfterMs:
        result.error !== undefined && "code" in result.error && result.error.code === "ETIMEDOUT"
          ? timeoutMs
          : null,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  if (result.error !== undefined) {
    if ("code" in result.error && result.error.code === "ENOENT")
      return { kind: "not-found", command };
    throw result.error;
  }
  return {
    kind: "exited",
    code: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function describeFailure(run: Exclude<ToolRun, { kind: "not-found" }>): string {
  return run.kind === "exited"
    ? `exited ${run.code}`
    : run.timedOutAfterMs === null
      ? `was killed by ${run.signal}`
      : `timed out after ${run.timedOutAfterMs}ms and was killed by ${run.signal}`;
}

/** Runs a tool that must succeed; the error carries its stderr. */
export function runToolOrThrow(
  command: string,
  args: readonly string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): { stdout: string; stderr: string } {
  const run = runTool(command, args, timeoutMs);
  if (run.kind === "not-found") throw new Error(`${command} is not on PATH`);
  if (run.kind === "killed" || run.code !== 0)
    throw new Error(`${command} ${args.join(" ")} ${describeFailure(run)}:\n${run.stderr}`);
  return run;
}
