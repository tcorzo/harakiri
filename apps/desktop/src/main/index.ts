import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { configure, getConsoleSink, getLogger, withFilter } from "@logtape/logtape";
import { app, BrowserWindow, session } from "electron";

import { appVersion } from "../shared/identity";
import { env, isE2E } from "./env";
import { hostCapabilities, hostFacts } from "./host/index";
import { registerIpc } from "./ipc";
import { launcher } from "./launcher";
import { holdQuitUntilStopped, killOnExit, removeStaleMpvDirs } from "./lifecycle";
import * as player from "./player/index";
import { openRunLog } from "./run-log";
import {
  appUrlCheck,
  confineWebContents,
  contentSecurityPolicy,
  installContentSecurityPolicy,
} from "./security";
import { electronUpdater } from "./updater";
import { ownAppImage, startUpdates } from "./updates";
import type { Updates } from "./updates";

// Electron keys the single-instance lock on userData, so this must run before the lock.
if (env.HARAKIRI_USER_DATA !== undefined) {
  app.setPath("userData", env.HARAKIRI_USER_DATA);
}

const appUrl =
  process.env.ELECTRON_RENDERER_URL ??
  pathToFileURL(path.join(import.meta.dirname, "../renderer/index.html")).href;

const isAppUrl = appUrlCheck(appUrl);

// The window shows at once, painted in the background colour until the renderer's first frame.
// Waiting for ready-to-show instead hangs where Chromium composites in software (no GPU, or a
// GPU process that will not start): it never paints a window that was never shown, so the
// window stayed hidden and the renderer got no animation frames.
const createWindow = (): void => {
  const window = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: app.isPackaged,
    autoHideMenuBar: true,
    backgroundColor: "#0a0605",
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      additionalArguments: isE2E ? ["--harakiri-e2e"] : [],
    },
  });

  window.on("closed", () => {
    void player.stop();
  });
  void window.loadURL(appUrl);
};

const focusExistingWindow = (): void => {
  const [window] = BrowserWindow.getAllWindows();

  if (window === undefined) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  window.focus();
};

interface StartedUpdates {
  updates?: Updates;
}

const logger = getLogger(["harakiri", "app"]);

/** Logs what a terminal used to be the only witness of: crashes and the renderer's console. */
const logProcessTrouble = (): void => {
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection in main: {reason}", { reason });
  });
  app.on("render-process-gone", (_event, _contents, details) => {
    logger.error("The renderer is gone: {reason}, exit code {exitCode}", { ...details });
  });
  app.on("child-process-gone", (_event, details) => {
    logger.error("Electron's {type} process is gone: {reason}", { ...details });
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.on("console-message", ({ level, message, sourceId, lineNumber }) => {
      if (level !== "warning" && level !== "error") {
        return;
      }

      logger[level]("Renderer console: {message} ({sourceId}:{lineNumber})", {
        message,
        sourceId,
        lineNumber,
      });
    });
  });
};

/** Logs the host's facts once the keyring probe settles; reading them never rejects. */
const logHost = async (): Promise<void> => {
  const [facts, capabilities] = await Promise.all([hostFacts(), hostCapabilities()]);
  logger.info("host {facts}; capabilities {capabilities}", { facts, capabilities });
};

const main = async (): Promise<void> => {
  // Every run writes a file a later postmortem can read; the terminal only gets info and up.
  const runLog = openRunLog(app.getPath("logs"), new Date());

  await configure({
    sinks: { console: withFilter(getConsoleSink(), "info"), file: runLog.sink },
    loggers: [
      { category: ["harakiri"], lowestLevel: "debug", sinks: ["console", "file"] },
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console", "file"] },
    ],
  });
  logger.info("harakiri {version} on Electron {electron}, {platform}; this run logs to {path}", {
    version: appVersion,
    electron: process.versions.electron,
    platform: `${process.platform} ${process.arch}`,
    path: runLog.path,
  });
  logProcessTrouble();

  killOnExit(player.mpvPid);
  // Set once the app is ready; a quit before that has nothing to install.
  const started: StartedUpdates = {};
  holdQuitUntilStopped(app, player.stop, {
    afterStop: () => {
      started.updates?.installIfReady();
    },
  });
  app.on("second-instance", focusExistingWindow);
  app.on("web-contents-created", (_event, contents) => {
    confineWebContents(contents, isAppUrl);
  });
  app.on("window-all-closed", () => {
    app.quit();
  });

  removeStaleMpvDirs({
    dir: tmpdir(),
    uid: process.getuid?.() ?? -1,
    now: Date.now(),
    minAgeMs: 60_000,
  });

  await app.whenReady();

  // electron-updater requests through Electron's net stack, which needs ready.
  const updates = startUpdates({
    appImage: ownAppImage({
      appImage: env.APPIMAGE,
      appDir: env.APPDIR,
      execPath: process.execPath,
    }),
    createUpdater: electronUpdater,
    isPlaying: player.isPlaying,
    releaseLock: () => {
      app.releaseSingleInstanceLock();
    },
    quit: () => {
      app.quit();
    },
  });

  started.updates = updates;
  installContentSecurityPolicy(session.defaultSession, isAppUrl, contentSecurityPolicy(appUrl));
  registerIpc(isAppUrl, updates);
  createWindow();
  // The keyring probe can be slow or wait on a password prompt; it must never hold up the window.
  void logHost();
  void launcher.healAtStart();
};

// Not awaited: Electron emits `ready` only after the main module's top-level await settles, so
// awaiting `app.whenReady()` inside it would deadlock.
if (app.requestSingleInstanceLock()) {
  const start = async () => {
    try {
      await main();
    } catch (error) {
      logger.fatal("harakiri failed to start: {error}", { error });
      console.error("harakiri failed to start", error);
      app.exit(1);
    }
  };

  void start();
} else {
  app.exit(0);
}
