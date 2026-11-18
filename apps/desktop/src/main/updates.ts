import { getLogger } from "@logtape/logtape";

import type { UpdateStatus } from "../shared/bridge";

const log = getLogger(["harakiri", "updates"]);

export interface UpdaterLike {
  check(): Promise<unknown>;
  download(): Promise<unknown>;
  /** Cancels the download in flight, if any; its promise then rejects. */
  cancelDownload(): void;
  /** Synchronous; swaps the AppImage. `relaunch` starts the new one. */
  install(relaunch: boolean): boolean;
  onAvailable(listener: (version: string) => void): void;
  onNotAvailable(listener: () => void): void;
  onProgress(listener: (percent: number) => void): void;
  onDownloaded(listener: (version: string) => void): void;
  onError(listener: (error: Error) => void): void;
}

export interface UpdateDeps {
  readonly appImage: string | undefined;
  /** Called only when appImage is set. */
  readonly createUpdater: () => UpdaterLike;
  readonly isPlaying: () => boolean;
  readonly releaseLock: () => void;
  /** Quits the app; the quit hold stops mpv and then installs. */
  readonly quit: () => void;
  readonly checkEveryMs?: number; // 21_600_000
  readonly idlePollMs?: number; // 60_000
  /** How long after a check started a failed one is retried. */
  readonly retryAfterMs?: number; // 900_000
}

export interface Updates {
  status(): UpdateStatus;
  installIfReady(): void;
  /** Quits and relaunches into the downloaded update; does nothing unless one is ready. */
  restart(): void;
}

const CHECK_EVERY_MS = 21_600_000;
const IDLE_POLL_MS = 60_000;
const RETRY_AFTER_MS = 900_000;

/**
 * The AppImage this process runs from, or undefined. The AppImage runtime exports APPIMAGE and
 * APPDIR to its children, so a harakiri started from another AppImage's terminal inherits them;
 * trusting that APPIMAGE would make electron-updater overwrite the other program on install.
 */
export function ownAppImage(where: {
  readonly appImage: string | undefined;
  readonly appDir: string | undefined;
  readonly execPath: string;
}): string | undefined {
  const { appImage, appDir, execPath } = where;

  if (appImage === undefined || appDir === undefined) {
    return undefined;
  }

  return execPath.startsWith(`${appDir}/`) ? appImage : undefined;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// The error event sets the status, so a rejected promise only needs logging.
const swallow = (what: string) => (error: unknown) => {
  log.debug("update {what} rejected: {error}", { what, error });
};

export function startUpdates(deps: UpdateDeps): Updates {
  if (deps.appImage === undefined) {
    return {
      status: () => ({ state: "unsupported" }),
      installIfReady: () => {},
      restart: () => {},
    };
  }

  let updater: UpdaterLike;

  try {
    updater = deps.createUpdater();
  } catch (error) {
    const message = messageOf(error);
    log.error("update setup failed: {message}", { message });

    return {
      status: () => ({ state: "failed", message }),
      installIfReady: () => {},
      restart: () => {},
    };
  }

  let status: UpdateStatus = { state: "idle" };
  let lastCheckAt = 0;
  let relaunch = false;

  const set = (next: UpdateStatus): void => {
    status = next;
    log.info("update status {status}", { status: next });
  };

  const check = (): void => {
    lastCheckAt = Date.now();
    updater.check().catch(swallow("check"));
  };

  const download = (version: string): void => {
    set({ state: "downloading", version, percent: 0 });
    updater.download().catch((error: unknown) => {
      swallow("download")(error);

      if (status.state !== "downloading") {
        return;
      }
      const message = messageOf(error);
      set({ state: "failed", message });
      log.warn("update download failed: {message}", { message });
    });
  };

  updater.onAvailable((version) => {
    set({ state: "available", version });

    if (!deps.isPlaying()) {
      download(version);
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
  updater.onError((error) => {
    set({ state: "failed", message: error.message });
  });

  check();
  setInterval(() => {
    if (status.state !== "downloading" && status.state !== "ready") {
      check();
    }
  }, deps.checkEveryMs ?? CHECK_EVERY_MS);
  setInterval(() => {
    if (status.state === "available" && !deps.isPlaying()) {
      download(status.version);
    } else if (status.state === "downloading" && deps.isPlaying()) {
      // Status first: the cancelled download's rejection fails only while still downloading.
      set({ state: "available", version: status.version });
      updater.cancelDownload();
    } else if (
      status.state === "failed" &&
      Date.now() - lastCheckAt >= (deps.retryAfterMs ?? RETRY_AFTER_MS)
    ) {
      check();
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
        const message = messageOf(error);
        set({ state: "failed", message });
        log.error("update install failed: {message}", { message });
      }
    },
  };
}
