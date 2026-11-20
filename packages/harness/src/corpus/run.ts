import { spawn } from "node:child_process";

/** Runs a tool to completion without blocking the event loop; throws with its stderr on failure. */
export const runAsync = async (
  command: string,
  args: readonly string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string; stderr: string }> => {
  const timeoutMs = options.timeoutMs ?? 300_000;

  // oxlint-disable-next-line promise/avoid-new -- wraps the child_process event API, which has no promise form
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env ?? process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf-8").on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);

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

      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `${command} ${args.join(" ")} ${signal ? `was killed by ${signal}` : `exited ${code}`}:\n${stderr}`
          )
        );
      }
    });
  });
};

/** A tiny concurrency limiter: at most `limit` tasks run at once. */
export const limiter = (limit: number) => {
  let active = 0;
  const queue: (() => Promise<void>)[] = [];

  const dispatch = () => {
    if (active >= limit) {
      return;
    }

    const start = queue.shift();

    if (start) {
      active += 1;
      void start();
    }
  };

  return async <T>(task: () => Promise<T>): Promise<T> =>
    // oxlint-disable-next-line promise/avoid-new -- the promise settles from the queue, not from one callback
    await new Promise<T>((resolve, reject) => {
      queue.push(async () => {
        try {
          resolve(await task());
        } catch (error) {
          // oxlint-disable-next-line promise/prefer-promise-reject-errors -- hands the task's own rejection to its caller unchanged
          reject(error);
        } finally {
          active -= 1;
          dispatch();
        }
      });
      dispatch();
    });
};
