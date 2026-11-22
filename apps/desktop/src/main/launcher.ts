import { appendFile } from "node:fs/promises";
import path from "node:path";

import { getLogger } from "@logtape/logtape";
import { app, shell } from "electron";
import { match } from "ts-pattern";

import type { LauncherAddResult, LauncherStatus } from "../shared/bridge";
import { env, isE2E } from "./env";
import { addToLauncher, artworkDir, healLauncher, launcherName, launcherState } from "./host";
import type { LauncherWhere } from "./host";
import { ownAppImage } from "./updates";

const logger = getLogger(["harakiri", "launcher"]);

export interface LauncherDeps {
  readonly where: () => LauncherWhere;
  readonly openExternal: (url: string) => Promise<void>;
  readonly tmpDir: string | undefined;
}

export interface Launcher {
  readonly status: () => Promise<LauncherStatus>;
  /** Single flight: a call while one runs gets the same promise. */
  readonly add: () => Promise<LauncherAddResult>;
  /** Never rejects; logs the report at info when anything changed. */
  readonly healAtStart: () => Promise<void>;
}

export const createLauncher = (deps: LauncherDeps): Launcher => {
  let running: Promise<LauncherAddResult> | undefined;

  const status = async (): Promise<LauncherStatus> =>
    match(await launcherState(deps.where()))
      .returnType<LauncherStatus>()
      .with("unavailable", () => ({ state: "unavailable" }))
      .with("offered", () => ({ state: "offered", name: launcherName }))
      .with("added", () => ({ state: "added", name: launcherName }))
      .exhaustive();

  const add = async (): Promise<LauncherAddResult> => {
    if (running !== undefined) {
      return await running;
    }

    const attempt = (async (): Promise<LauncherAddResult> => {
      try {
        // Already listed: nothing new to write or open.
        if ((await launcherState(deps.where())) === "added") {
          return { state: "added" };
        }

        return await addToLauncher(deps.where(), {
          openExternal: deps.openExternal,
          tmpDir: deps.tmpDir,
        });
      } catch (error) {
        return { state: "failed", reason: error instanceof Error ? error.message : String(error) };
      }
    })();

    running = attempt;

    try {
      return await attempt;
    } finally {
      running = undefined;
    }
  };

  const healAtStart = async (): Promise<void> => {
    try {
      const report = await healLauncher(deps.where());
      const wroteArt = report.artwork.some((user) => user.written.length > 0);

      if (report.launcher === "rewritten" || wroteArt) {
        logger.info("Healed the {launcher} launcher at start: {report}", {
          launcher: launcherName,
          report,
        });
      }
    } catch (error) {
      logger.warn("Could not heal the {launcher} launcher: {error}", {
        launcher: launcherName,
        error,
      });
    }
  };

  return { status, add, healAtStart };
};

const where = (): LauncherWhere => {
  const userData = app.getPath("userData");

  return {
    userData,
    target: isE2E
      ? env.HARAKIRI_E2E_LAUNCH_TARGET
      : ownAppImage({ appImage: env.APPIMAGE, appDir: env.APPDIR, execPath: process.execPath }),
    artwork: artworkDir({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      mainDir: import.meta.dirname,
    }),
  };
};

/** In e2e the URL is recorded under userData instead of opened, so no real launcher is needed. */
const recordUrl = async (url: string): Promise<void> => {
  await appendFile(path.join(app.getPath("userData"), "e2e-opened-urls.txt"), `${url}\n`);
};

/** The app's launcher. */
export const launcher = createLauncher({
  where,
  openExternal: isE2E
    ? recordUrl
    : async (url) => {
        await shell.openExternal(url);
      },
  // Read when an add starts: `userData` may be redirected after this module loads.
  get tmpDir() {
    return isE2E ? app.getPath("userData") : undefined;
  },
});
