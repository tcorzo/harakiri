import { access, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getLogger } from "@logtape/logtape";
import { match } from "ts-pattern";

import { steamLibraryOf } from "../capabilities";
import type { SteamFacts, SteamUser } from "../facts";
import { writeArtwork } from "./artwork";
import { writeLauncher } from "./launcher";
import type { LauncherFiles } from "./launcher";
import { shortcutFor } from "./shortcuts-vdf";
import type { Shortcut } from "./shortcuts-vdf";

const logger = getLogger(["harakiri", "host", "steam"]);

/** Steam looks for its sentinel here, whatever TMPDIR says. */
export const STEAM_TMP = "/tmp";
export const POLL_MS = 500;
export const TIMEOUT_MS = 30_000;

const SENTINEL = "addnonsteamgamefile";

export interface LauncherPlace {
  readonly files: LauncherFiles;
  /** The AppImage; undefined when not running from one. */
  readonly target: string | undefined;
  /** The directory holding `icon.png` and the grid PNGs. */
  readonly artwork: string;
}

export type LauncherState = "unavailable" | "offered" | "added";

export type AddResult =
  | { readonly state: "added" }
  | { readonly state: "timedOut" }
  | { readonly state: "failed"; readonly reason: string };

export interface AddDeps {
  readonly openExternal: (url: string) => Promise<void>;
  readonly readSteam: () => Promise<SteamFacts>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly tmpDir: string;
}

export interface HealReport {
  readonly launcher: "no-target" | "absent" | "unchanged" | "rewritten";
  readonly artwork: readonly { readonly user: string; readonly written: readonly string[] }[];
}

const NOT_APPIMAGE = "harakiri is not running from its AppImage";

/** unavailable: no target or steamLibraryOf is "absent"; added: "has-harakiri"; offered: "present". */
export const steamLauncherState = (steam: SteamFacts, place: LauncherPlace): LauncherState =>
  place.target === undefined
    ? "unavailable"
    : match(steamLibraryOf(steam, place.files.script))
        .returnType<LauncherState>()
        .with("absent", () => "unavailable")
        .with("present", () => "offered")
        .with("has-harakiri", () => "added")
        .exhaustive();

interface Listed {
  readonly user: SteamUser;
  readonly shortcut: Shortcut;
}

/** The users whose shortcuts run our script, with the shortcut Steam gave each. */
const listedIn = (steam: SteamFacts, script: string): readonly Listed[] =>
  steam.users.flatMap((user) => {
    const shortcut = shortcutFor(user.shortcuts, script);

    return shortcut === undefined ? [] : [{ user, shortcut }];
  });

interface ArtworkOutcome {
  readonly report: HealReport["artwork"];
  /** Every listed user's art was written or already there. */
  readonly complete: boolean;
}

/** Writes the art each listed user lacks. One user's failure is a warning, not the others'. */
const artworkFor = async (artwork: string, listed: readonly Listed[]): Promise<ArtworkOutcome> => {
  const outcomes = await Promise.all(
    listed.map(async ({ user, shortcut }) => {
      try {
        return {
          user: user.id,
          written: await writeArtwork(artwork, user.gridDir, shortcut.appId),
          failed: false,
        };
      } catch (error) {
        logger.warn("Art for user {user} could not be written: {error}", { user: user.id, error });

        return { user: user.id, written: [], failed: true };
      }
    })
  );

  return {
    report: outcomes.map(({ user, written }) => ({ user, written })),
    complete: outcomes.every((outcome) => !outcome.failed),
  };
};

/**
 * Marks art as owed: an add that timed out before Steam listed the shortcut sets it, and the heal
 * that writes the art clears it. Without it the heal writes no art, so art the owner removed in
 * Steam stays removed.
 */
const artOwedFile = (files: LauncherFiles): string => path.join(files.dir, "art-owed");

const owesArt = async (files: LauncherFiles, owed: boolean): Promise<void> => {
  const file = artOwedFile(files);

  try {
    await (owed ? writeFile(file, "") : rm(file, { force: true }));
  } catch (error) {
    logger.warn("The art-owed mark {file} could not be updated: {error}", { file, error });
  }
};

/** Creates the sentinel empty; false when it was already there, so it is not ours to remove. */
const createSentinel = async (sentinel: string): Promise<boolean> => {
  try {
    await writeFile(sentinel, "", { flag: "wx" });

    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return false;
    }

    throw error;
  }
};

/** A read that rejects counts as Steam not listing us yet, so the poll keeps going. */
const readOrNoSteam = async (deps: AddDeps): Promise<SteamFacts> => {
  try {
    return await deps.readSteam();
  } catch (error) {
    logger.warn("Steam's user data could not be read: {error}", { error });

    return { root: undefined, users: [] };
  }
};

const pollForShortcut = async (place: LauncherPlace, deps: AddDeps): Promise<AddResult> => {
  const start = deps.now();

  /* oxlint-disable eslint/no-await-in-loop -- polling: each read must follow the previous wait */
  for (;;) {
    const listed = listedIn(await readOrNoSteam(deps), place.files.script);

    if (listed.length > 0) {
      const { report, complete } = await artworkFor(place.artwork, listed);

      for (const [index, { user, shortcut }] of listed.entries()) {
        logger.info("The launcher listed harakiri as {appId} for user {user}; wrote {written}", {
          appId: shortcut.appId,
          user: user.id,
          written: report[index]?.written ?? [],
        });
      }

      await owesArt(place.files, !complete);

      return { state: "added" };
    }

    if (deps.now() - start >= TIMEOUT_MS) {
      logger.info("The launcher did not list harakiri within {ms} ms", { ms: TIMEOUT_MS });
      await owesArt(place.files, true);

      return { state: "timedOut" };
    }

    await deps.sleep(POLL_MS);
  }
  /* oxlint-enable eslint/no-await-in-loop */
};

const removeSentinel = async (sentinel: string): Promise<void> => {
  try {
    await rm(sentinel, { force: true });
  } catch (error) {
    logger.warn("The sentinel {sentinel} could not be removed: {error}", { sentinel, error });
  }
};

/**
 * Writes the launcher, opens Steam's add URL with the sentinel present, then polls Steam's
 * shortcuts until one runs our script, and writes its art. Never rejects.
 */
export const addToSteam = async (place: LauncherPlace, deps: AddDeps): Promise<AddResult> => {
  const { target, files } = place;

  if (target === undefined) {
    return { state: "failed", reason: NOT_APPIMAGE };
  }

  const sentinel = path.join(deps.tmpDir, SENTINEL);
  let created = false;

  try {
    await writeLauncher(files, target, place.artwork);
    created = await createSentinel(sentinel);
    await deps.openExternal(`steam://addnonsteamgame/${encodeURIComponent(files.desktop)}`);
    logger.info("Asked the launcher to add {desktop}", { desktop: files.desktop });

    return await pollForShortcut(place, deps);
  } catch (error) {
    return { state: "failed", reason: error instanceof Error ? error.message : String(error) };
  } finally {
    if (created) {
      await removeSentinel(sentinel);
    }
  }
};

const exists = async (file: string): Promise<boolean> =>
  await access(file).then(
    () => true,
    () => false
  );

/**
 * At startup: points the launcher at the current AppImage. When an earlier add timed out before
 * its art was written, writes the art Steam's shortcut lacks, keeping any already in `grid/`.
 * Never rejects.
 */
export const healSteamLauncher = async (
  place: LauncherPlace,
  steam: SteamFacts
): Promise<HealReport> => {
  const { target, files } = place;

  if (target === undefined) {
    return { launcher: "no-target", artwork: [] };
  }

  const listed = listedIn(steam, files.script);

  if (listed.length === 0 && !(await exists(files.script))) {
    return { launcher: "absent", artwork: [] };
  }

  let launcher: HealReport["launcher"] = "unchanged";

  try {
    launcher = (await writeLauncher(files, target, place.artwork)) ? "rewritten" : "unchanged";
  } catch (error) {
    logger.warn("The launcher could not be rewritten: {error}", { error });
  }

  if (listed.length === 0 || !(await exists(artOwedFile(files)))) {
    return { launcher, artwork: [] };
  }

  const { report, complete } = await artworkFor(place.artwork, listed);

  if (complete) {
    await owesArt(files, false);
  }

  return { launcher, artwork: report };
};
