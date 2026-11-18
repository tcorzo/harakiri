import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { configure, getConsoleSink, getLogger, withFilter } from "@logtape/logtape";
import { app, BrowserWindow, session } from "electron";
import { env, isE2E } from "./env";
import { registerIpc } from "./ipc";
import { appVersion } from "../shared/identity";
import { holdQuitUntilStopped, killOnExit, removeStaleMpvDirs } from "./lifecycle";
import * as player from "./player/index";
import { openRunLog } from "./run-log";
import { electronUpdater } from "./updater";
import { ownAppImage, startUpdates, type Updates } from "./updates";
import {
  appUrlCheck,
  confineWebContents,
  contentSecurityPolicy,
  installContentSecurityPolicy,
} from "./security";

// Electron keys the single-instance lock on userData, so this must run before the lock.
if (env.HARAKIRI_USER_DATA !== undefined) app.setPath("userData", env.HARAKIRI_USER_DATA);

const appUrl =
  process.env["ELECTRON_RENDERER_URL"] ??
  pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href;
const isAppUrl = appUrlCheck(appUrl);

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    fullscreen: app.isPackaged,
    autoHideMenuBar: true,
    backgroundColor: "#0b0d12",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      additionalArguments: isE2E ? ["--harakiri-e2e"] : [],
    },
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => void player.stop());
  void window.loadURL(appUrl);
}

function focusExistingWindow(): void {
  const [window] = BrowserWindow.getAllWindows();
  if (window === undefined) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

const logger = getLogger(["harakiri", "app"]);

/** Logs what a terminal used to be the only witness of: crashes and the renderer's console. */
function logProcessTrouble(): void {
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
      if (level !== "warning" && level !== "error") return;
      logger[level]("Renderer console: {message} ({sourceId}:{lineNumber})", {
        message,
        sourceId,
        lineNumber,
      });
    });
  });
}

async function main(): Promise<void> {
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
  let updates: Updates | undefined;
  holdQuitUntilStopped(app, player.stop, { afterStop: () => updates?.installIfReady() });
  app.on("second-instance", focusExistingWindow);
  app.on("web-contents-created", (_event, contents) => confineWebContents(contents, isAppUrl));
  app.on("window-all-closed", () => app.quit());

  removeStaleMpvDirs({
    dir: tmpdir(),
    uid: process.getuid?.() ?? -1,
    now: Date.now(),
    minAgeMs: 60_000,
  });

  await app.whenReady();
  // electron-updater requests through Electron's net stack, which needs ready.
  updates = startUpdates({
    appImage: ownAppImage({
      appImage: env.APPIMAGE,
      appDir: env.APPDIR,
      execPath: process.execPath,
    }),
    createUpdater: electronUpdater,
    isPlaying: player.isPlaying,
    releaseLock: () => app.releaseSingleInstanceLock(),
    quit: () => app.quit(),
  });
  installContentSecurityPolicy(session.defaultSession, isAppUrl, contentSecurityPolicy(appUrl));
  registerIpc(isAppUrl, updates);
  createWindow();
}

// Not awaited: Electron emits `ready` only after the main module's top-level await settles, so
// awaiting `app.whenReady()` inside it would deadlock.
if (app.requestSingleInstanceLock()) {
  main().catch((error: unknown) => {
    logger.fatal("harakiri failed to start: {error}", { error });
    console.error("harakiri failed to start", error);
    app.exit(1);
  });
} else {
  app.exit(0);
}
