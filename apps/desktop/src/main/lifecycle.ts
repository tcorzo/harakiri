import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { getLogger } from "@logtape/logtape";

const logger = getLogger(["harakiri", "lifecycle"]);

export const STOP_CAP_MS = 5000;

/** Runs `stop`, giving up after `capMs` so a hung mpv can never keep the app from quitting. */
export async function stopWithin(
  stop: () => Promise<void>,
  capMs: number
): Promise<"stopped" | "timed-out" | "failed"> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<"timed-out">((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), capMs);
  });

  try {
    return await Promise.race([
      stop().then(
        () => "stopped" as const,
        (error: unknown) => {
          logger.error("Stopping playback on quit failed: {error}", { error });

          return "failed" as const;
        }
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

interface QuittingApp {
  on(event: "before-quit", listener: (event: { preventDefault(): void }) => void): unknown;
  exit(code?: number): void;
}

interface HoldOptions {
  readonly capMs?: number;
  readonly afterStop?: () => void;
}

/**
 * Holds every quit until playback has stopped (capped), then runs afterStop, then exits without
 * re-entering quit. A throwing afterStop is logged and still exits.
 */
export function holdQuitUntilStopped(
  app: QuittingApp,
  stop: () => Promise<void>,
  options: HoldOptions = {}
): void {
  const capMs = options.capMs ?? STOP_CAP_MS;
  let stopping = false;
  app.on("before-quit", (event) => {
    event.preventDefault();

    if (stopping) {
      return;
    }
    stopping = true;
    void stopWithin(stop, capMs).then((outcome) => {
      if (outcome === "timed-out") {
        logger.warn("mpv did not stop within {capMs} ms", { capMs });
      }

      try {
        options.afterStop?.();
      } catch (error) {
        logger.error("Installing the update on quit failed: {error}", { error });
      }

      app.exit(0);
    });
  });
}

/** SIGKILLs mpv if it is still alive when Node exits, so a crash or `app.exit` never orphans it. */
export function killOnExit(livePid: () => number | undefined): void {
  process.on("exit", () => {
    const pid = livePid();

    if (pid === undefined || pid <= 0) {
      return;
    }

    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  });
}

/**
 * Removes mpv socket dirs (`harakiri-mpv-*`) left behind by a crash. Only dirs this user owns and
 * older than `minAgeMs` go, so a test or harness spawning mpv right now keeps its socket.
 */
export function removeStaleMpvDirs(options: {
  readonly dir: string;
  readonly uid: number;
  readonly now: number;
  readonly minAgeMs: number;
}): string[] {
  const removed: string[] = [];
  let names: string[];

  try {
    names = readdirSync(options.dir);
  } catch {
    return removed;
  }

  for (const name of names) {
    if (!name.startsWith("harakiri-mpv-")) {
      continue;
    }
    const path = join(options.dir, name);

    try {
      const stat = statSync(path);

      if (!stat.isDirectory() || stat.uid !== options.uid) {
        continue;
      }

      if (options.now - stat.mtimeMs < options.minAgeMs) {
        continue;
      }
      rmSync(path, { recursive: true, force: true });
      removed.push(path);
    } catch (error) {
      logger.warn("Could not remove stale mpv dir {path}: {error}", { path, error });
    }
  }

  return removed;
}
