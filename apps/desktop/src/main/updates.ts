import { getLogger } from "@logtape/logtape";
import { z } from "zod";

import type { UpdateStatus } from "../shared/bridge";

const log = getLogger(["harakiri", "updates"]);

export interface UpdaterLike {
  check: () => Promise<void>;
  download: () => Promise<void>;
  /** Cancels the download in flight, if any; its promise then rejects. */
  cancelDownload: () => void;
  /** Synchronous; swaps the AppImage. `relaunch` starts the new one. */
  install: (relaunch: boolean) => boolean;
  onAvailable: (listener: (version: string) => void) => void;
  onNotAvailable: (listener: () => void) => void;
  onProgress: (listener: (percent: number) => void) => void;
  onDownloaded: (listener: (version: string) => void) => void;
  onError: (listener: (error: Error) => void) => void;
}

export interface UpdateDeps {
  readonly appImage: string | undefined;
  /** Called only when appImage is set. */
  readonly createUpdater: () => UpdaterLike;
  readonly isPlaying: () => boolean;
  readonly releaseLock: () => void;
  /** Quits the app; the quit hold stops mpv and then installs. */
  readonly quit: () => void;
  /** Default 21_600_000. */
  readonly checkEveryMs?: number;
  /** Default 60_000. */
  readonly idlePollMs?: number;
  /** How long after a check started a failed one is retried. Default 900_000. */
  readonly retryAfterMs?: number;
}

export interface Updates {
  status: () => UpdateStatus;
  installIfReady: () => void;
  /** Quits and relaunches into the downloaded update; does nothing unless one is ready. */
  restart: () => void;
}

const CHECK_EVERY_MS = 21_600_000;
const IDLE_POLL_MS = 60_000;
const RETRY_AFTER_MS = 900_000;

/**
 * The AppImage this process runs from, or undefined. The AppImage runtime exports APPIMAGE and
 * APPDIR to its children, so a harakiri started from another AppImage's terminal inherits them;
 * trusting that APPIMAGE would make electron-updater overwrite the other program on install.
 */
export const ownAppImage = (where: {
  readonly appImage: string | undefined;
  readonly appDir: string | undefined;
  readonly execPath: string;
}): string | undefined => {
  const { appImage, appDir, execPath } = where;

  if (appImage === undefined || appDir === undefined) {
    return undefined;
  }

  return execPath.startsWith(`${appDir}/`) ? appImage : undefined;
};

const noop = (): void => {
  // Nothing to do.
};

// Whatever a catch clause holds, as the text to show: an Error's message, else its string form.
const ThrownMessage = z
  .unknown()
  .transform((thrown) => (thrown instanceof Error ? thrown.message : String(thrown)));

const FeedStatus = z.object({ statusCode: z.union([z.literal(401), z.literal(404)]) });
const FEED_STATUS = /\bHttpError: (?<status>401|404)\b/u;

/**
 * The status when an update feed answers 401 or 404, which GitHub does for a private repository,
 * else undefined. Reads electron-updater's `statusCode`, or its text when only text is left.
 */
export const feedUnreachable = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a catch clause and a log line hand over anything; FeedStatus and FEED_STATUS parse it here
  error: unknown
): 401 | 404 | undefined => {
  const fromCode = FeedStatus.safeParse(error);

  if (fromCode.success) {
    return fromCode.data.statusCode;
  }

  const status = FEED_STATUS.exec(String(error))?.groups?.status;

  if (status === "401") {
    return 401;
  }

  return status === "404" ? 404 : undefined;
};

export const startUpdates = (deps: UpdateDeps): Updates => {
  if (deps.appImage === undefined) {
    return {
      status: () => ({ state: "unsupported" }),
      installIfReady: noop,
      restart: noop,
    };
  }

  let updater: UpdaterLike;

  try {
    updater = deps.createUpdater();
  } catch (error) {
    const message = ThrownMessage.parse(error);
    log.error("update setup failed: {message}", { message });

    return {
      status: () => ({ state: "failed", message }),
      installIfReady: noop,
      restart: noop,
    };
  }

  let status: UpdateStatus = { state: "idle" };
  let lastCheckAt = 0;
  let relaunch = false;

  const set = (next: UpdateStatus): void => {
    status = next;
    log.info("update status {status}", { status: next });
  };

  // The error event sets the status, so a rejected check only needs logging.
  const check = async (): Promise<void> => {
    lastCheckAt = Date.now();

    try {
      await updater.check();
    } catch (error) {
      log.debug("update check rejected: {error}", { error });
    }
  };

  const download = async (version: string): Promise<void> => {
    set({ state: "downloading", version, percent: 0 });

    try {
      await updater.download();
    } catch (error) {
      log.debug("update download rejected: {error}", { error });

      if (status.state !== "downloading") {
        return;
      }

      const message = ThrownMessage.parse(error);
      set({ state: "failed", message });
      log.warn("update download failed: {message}", { message });
    }
  };

  updater.onAvailable((version) => {
    set({ state: "available", version });

    if (!deps.isPlaying()) {
      void download(version);
    }
  });
  updater.onNotAvailable(() => {
    set({ state: "idle" });
  });
  updater.onProgress((percent) => {
    if (status.state === "downloading") {
      status = { state: "downloading", version: status.version, percent };
    }
  });
  updater.onDownloaded((version) => {
    set({ state: "ready", version });
  });
  updater.onError((failure) => {
    const unreachable = feedUnreachable(failure);

    if (unreachable === undefined) {
      set({ state: "failed", message: failure.message });

      return;
    }

    set({ state: "failed", message: `update feed unreachable (HTTP ${unreachable})` });
    log.warn("update feed unreachable (HTTP {status}); tries again later", {
      status: unreachable,
    });
  });

  void check();
  setInterval(() => {
    if (status.state !== "downloading" && status.state !== "ready") {
      void check();
    }
  }, deps.checkEveryMs ?? CHECK_EVERY_MS);
  setInterval(() => {
    if (status.state === "available" && !deps.isPlaying()) {
      void download(status.version);
    } else if (status.state === "downloading" && deps.isPlaying()) {
      // Status first: the cancelled download's rejection fails only while still downloading.
      set({ state: "available", version: status.version });
      updater.cancelDownload();
    } else if (
      status.state === "failed" &&
      Date.now() - lastCheckAt >= (deps.retryAfterMs ?? RETRY_AFTER_MS)
    ) {
      void check();
    }
  }, deps.idlePollMs ?? IDLE_POLL_MS);

  return {
    status: () => status,
    restart: () => {
      if (status.state !== "ready") {
        return;
      }

      relaunch = true;
      deps.quit();
    },
    installIfReady: () => {
      if (status.state !== "ready") {
        return;
      }

      if (relaunch) {
        deps.releaseLock();
      }

      try {
        updater.install(relaunch);
      } catch (error) {
        const message = ThrownMessage.parse(error);
        set({ state: "failed", message });
        log.error("update install failed: {message}", { message });
      }
    },
  };
};
