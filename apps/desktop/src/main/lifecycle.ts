import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { getLogger } from "@logtape/logtape";

const logger = getLogger(["harakiri", "lifecycle"]);

export const STOP_CAP_MS = 5000;

/** Runs `stop`, giving up after `capMs` so a hung mpv can never keep the app from quitting. */
export const stopWithin = async (
  stop: () => Promise<void>,
  capMs: number
): Promise<"stopped" | "timed-out" | "failed"> => {
  const timer = new AbortController();
  const timeout = delay(capMs, "timed-out" as const, { signal: timer.signal });

  const stopped = async () => {
    try {
      await stop();

      return "stopped" as const;
    } catch (error) {
      logger.error("Stopping playback on quit failed: {error}", { error });

      return "failed" as const;
    }
  };

  try {
    return await Promise.race([stopped(), timeout]);
  } finally {
    timer.abort();
  }
};

interface QuittingApp {
  on: (event: "before-quit", listener: (event: { preventDefault: () => void }) => void) => void;
  exit: (code?: number) => void;
}

interface HoldOptions {
  readonly capMs?: number;
  readonly afterStop?: () => void;
}

/**
 * Holds every quit until playback has stopped (capped), then runs afterStop, then exits without
 * re-entering quit. A throwing afterStop is logged and still exits.
 */
export const holdQuitUntilStopped = (
  app: QuittingApp,
  stop: () => Promise<void>,
  options: HoldOptions = {}
): void => {
  const capMs = options.capMs ?? STOP_CAP_MS;
  let stopping = false;

  const stopThenExit = async () => {
    const outcome = await stopWithin(stop, capMs);

    if (outcome === "timed-out") {
      logger.warn("mpv did not stop within {capMs} ms", { capMs });
    }

    try {
      options.afterStop?.();
    } catch (error) {
      logger.error("Installing the update on quit failed: {error}", { error });
    }

    app.exit(0);
  };

  app.on("before-quit", (event) => {
    event.preventDefault();

    if (stopping) {
      return;
    }

    stopping = true;
    void stopThenExit();
  });
};

/** SIGKILLs mpv if it is still alive when Node exits, so a crash or `app.exit` never orphans it. */
export const killOnExit = (livePid: () => number | undefined): void => {
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
};

/**
 * Removes mpv socket dirs (`harakiri-mpv-*`) left behind by a crash. Only dirs this user owns and
 * older than `minAgeMs` go, so a test or harness spawning mpv right now keeps its socket.
 */
export const removeStaleMpvDirs = (options: {
  readonly dir: string;
  readonly uid: number;
  readonly now: number;
  readonly minAgeMs: number;
}): string[] => {
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

    const stalePath = path.join(options.dir, name);

    try {
      const stat = statSync(stalePath);

      if (!stat.isDirectory() || stat.uid !== options.uid) {
        continue;
      }

      if (options.now - stat.mtimeMs < options.minAgeMs) {
        continue;
      }

      rmSync(stalePath, { recursive: true, force: true });
      removed.push(stalePath);
    } catch (error) {
      logger.warn("Could not remove stale mpv dir {path}: {error}", { path: stalePath, error });
    }
  }

  return removed;
};
