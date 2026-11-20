import { getLogger } from "@logtape/logtape";
import pkg from "electron-updater";
import type { BaseUpdater, CancellationToken } from "electron-updater";

import type { UpdaterLike } from "./updates";

// electron-updater is CJS and the main bundle is ESM, so take the named exports off the default.
const { BaseUpdater: BaseUpdaterClass, CancellationToken: CancellationTokenClass } = pkg;

const log = getLogger(["harakiri", "updates", "electron-updater"]);

// Passed as a property, never as the template: electron-updater's messages contain braces that
// logtape would read as placeholders.
const text = String;

type Subscribe<Event extends string, Listener> = (event: Event, listener: Listener) => void;

/** The part of `BaseUpdater` the adapter drives, so a test double needs no cast. */
export type InstallingUpdater = Pick<
  BaseUpdater,
  | "autoDownload"
  | "autoInstallOnAppQuit"
  | "logger"
  | "checkForUpdates"
  | "downloadUpdate"
  | "install"
> & {
  on: Subscribe<"update-available", (info: { readonly version: string }) => void> &
    Subscribe<"update-not-available", () => void> &
    Subscribe<"download-progress", (info: { readonly percent: number }) => void> &
    Subscribe<"update-downloaded", (event: { readonly version: string }) => void> &
    Subscribe<"error", (error: Error) => void>;
};

/** Wraps electron-updater so the update controller sees only the narrow `UpdaterLike`. */
export const adaptUpdater = (real: InstallingUpdater): UpdaterLike => {
  real.autoDownload = false;
  real.autoInstallOnAppQuit = false;
  real.logger = {
    info: (message) => {
      log.info("{m}", { m: text(message) });
    },
    warn: (message) => {
      log.warn("{m}", { m: text(message) });
    },
    error: (message) => {
      log.error("{m}", { m: text(message) });
    },
  };

  // The token of the download in flight; cancelDownload cancels it.
  let token: CancellationToken | undefined;

  return {
    check: async () => {
      await real.checkForUpdates();
    },
    download: async () => {
      token = new CancellationTokenClass();
      await real.downloadUpdate(token);
    },
    cancelDownload: () => {
      token?.cancel();
      token = undefined;
    },
    install: (relaunch) => real.install(true, relaunch),
    onAvailable: (listener) => {
      real.on("update-available", (info) => {
        listener(info.version);
      });
    },
    onNotAvailable: (listener) => {
      real.on("update-not-available", () => {
        listener();
      });
    },
    onProgress: (listener) => {
      real.on("download-progress", (info) => {
        listener(info.percent);
      });
    },
    onDownloaded: (listener) => {
      real.on("update-downloaded", (event) => {
        listener(event.version);
      });
    },
    onError: (listener) => {
      real.on("error", (error) => {
        listener(error);
      });
    },
  };
};

/** The packaged AppImage updater. Lazy: nothing touches `autoUpdater` until this is called. */
export const electronUpdater = (): UpdaterLike => {
  const updater = pkg.autoUpdater;

  if (!(updater instanceof BaseUpdaterClass)) {
    throw new TypeError("electron-updater did not pick an installing updater on this platform");
  }

  return adaptUpdater(updater);
};
