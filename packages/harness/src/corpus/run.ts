import { spawn } from "node:child_process";

/** Runs a tool to completion without blocking the event loop; throws with its stderr on failure. */
export function runAsync(
  command: string,
  args: readonly string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = options.timeoutMs ?? 300_000;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env ?? process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        error.code === "ENOENT"
          ? new Error(`${command} is not on PATH (run through mise so the pinned tools are found)`)
          : error
      );
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);

      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${command} ${args.join(" ")} ${signal ? `was killed by ${signal}` : `exited ${code}`}:\n${stderr}`
          )
        );
    });
  });
}

/** A tiny concurrency limiter: at most `limit` tasks run at once. */
export function limiter(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  const next = () => {
    if (active >= limit) return;
    const start = queue.shift();

    if (start) {
      active++;
      start();
    }
  };

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() =>
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          })
      );
      next();
    });
}
