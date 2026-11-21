import { setTimeout as sleep } from "node:timers/promises";

import type { HdrSignalling } from "@harakiri/fidelity";
import { safeStorage } from "electron";

import type { HostCapabilities } from "./capabilities";
import { readSteamFacts } from "./facts";
import type { HostFacts, SteamFacts } from "./facts";
import { createHost } from "./host";
import { addToSteam, healSteamLauncher, STEAM_TMP, steamLauncherState } from "./steam/add";
import type { AddResult, HealReport, LauncherPlace, LauncherState } from "./steam/add";
import { launcherFiles } from "./steam/launcher";

export type { AddResult, HealReport, LauncherState } from "./steam/add";

/** Where the launcher icon and library art are; the caller passes Electron's values. */
export { artworkDir } from "./steam/artwork";

export type { HostCapabilities, SecretStore } from "./capabilities";

export type { EnvFacts, HostFacts, SecretProbe } from "./facts";

// The environment is read on first use; `safeStorage` only when the secret facts are first asked.
const host = createHost(process.env, safeStorage);

/**
 * This machine's facts, read once. Electron names its secret backend only after `app.whenReady()`.
 * Never rejects, but can wait on the OS keyring: keep it off the path to the window.
 */
export const hostFacts = async (): Promise<HostFacts> => await host.facts();

/** What this machine can do. Call only after `app.whenReady()`; it waits on the keyring probe. */
export const hostCapabilities = async (): Promise<HostCapabilities> => await host.capabilities();

/** How the compositor takes HDR, from the environment alone: it never waits on the keyring. */
export const hostSignalling = (): HdrSignalling => host.signalling();

/** Where the launcher lives and what it starts. */
export interface LauncherWhere {
  /** Electron's `userData`; the launcher files go under it. */
  readonly userData: string;
  /** The AppImage; undefined when not running from one. */
  readonly target: string | undefined;
  /** The directory holding the launcher icon and library art (`artworkDir`). */
  readonly artwork: string;
}

/** The game launcher harakiri can add itself to, for the UI to name. */
export const launcherName = "Steam";

const placeOf = (where: LauncherWhere): LauncherPlace => ({
  files: launcherFiles(where.userData),
  target: where.target,
  artwork: where.artwork,
});

const readSteam = async (): Promise<SteamFacts> => await readSteamFacts(process.env);

/** Whether harakiri can be added to the launcher, or already is. Reads the disk on every call. */
export const launcherState = async (where: LauncherWhere): Promise<LauncherState> =>
  steamLauncherState(await readSteam(), placeOf(where));

/** Asks the launcher to add harakiri and waits until it lists it. Never rejects. */
export const addToLauncher = async (
  where: LauncherWhere,
  deps: { readonly openExternal: (url: string) => Promise<void>; readonly tmpDir?: string }
): Promise<AddResult> =>
  await addToSteam(placeOf(where), {
    openExternal: deps.openExternal,
    readSteam,
    sleep: async (ms) => {
      await sleep(ms);
    },
    now: Date.now,
    tmpDir: deps.tmpDir ?? STEAM_TMP,
  });

/** Points an existing launcher at this AppImage and fills in missing art. Never rejects. */
export const healLauncher = async (where: LauncherWhere): Promise<HealReport> =>
  await healSteamLauncher(placeOf(where), await readSteam());
