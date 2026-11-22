import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { configure, reset as resetLogging } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSteamFacts } from "../facts";
import type { SteamFacts } from "../facts";
import { fakeSteamRoot } from "../fixtures/steam-root";
import { addToSteam, healSteamLauncher, POLL_MS, steamLauncherState, TIMEOUT_MS } from "./add";
import type { AddDeps, LauncherPlace } from "./add";
import { encodeShortcuts } from "./fixtures/vdf";
import type { ShortcutEntry } from "./fixtures/vdf";
import { launcherFiles, launcherScript, writeLauncher } from "./launcher";

const ARTWORK = path.resolve(import.meta.dirname, "../../../../build/steam");
const APP_ID = 3_141_592_653;
const TARGET = "/opt/h.AppImage";
const ALL_ART = ["3141592653p.png", "3141592653.png", "3141592653_hero.png", "3141592653_logo.png"];

/** Captures what `harakiri` logs while `run` runs. */
const recording = async (run: () => Promise<void>): Promise<LogRecord[]> => {
  const records: LogRecord[] = [];

  await configure({
    reset: true,
    sinks: {
      memory: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ["harakiri"], lowestLevel: "debug", sinks: ["memory"] },
      { category: ["logtape", "meta"], sinks: [] },
    ],
  });

  try {
    await run();
  } finally {
    await resetLogging();
  }

  return records;
};

/** The message templates logged at `level`, in order. */
const at = (records: readonly LogRecord[], level: LogRecord["level"]) =>
  records.flatMap((record) => (record.level === level ? [record.rawMessage] : []));

describe("add to Steam", () => {
  let root = "";
  let home = "";
  let tmp = "";
  let userData = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "harakiri-add-"));
    home = path.join(root, "home");
    tmp = path.join(root, "tmp");
    userData = path.join(root, "userData");
    await mkdir(tmp);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const files = () => launcherFiles(userData);

  const place = (): LauncherPlace => ({ files: files(), target: TARGET, artwork: ARTWORK });

  const ours = (): ShortcutEntry => ({
    appId: APP_ID,
    appName: "harakiri",
    exe: `"${files().script}"`,
  });

  const config = (user: string) =>
    path.join(home, ".local", "share", "Steam", "userdata", user, "config");

  const grid = (user: string) => path.join(config(user), "grid");

  const sentinel = () => path.join(tmp, "addnonsteamgamefile");

  const readSteam = async (): Promise<SteamFacts> => await readSteamFacts({ HOME: home });

  const writeShortcuts = async (user: string, bytes: Uint8Array) => {
    await writeFile(path.join(config(user), "shortcuts.vdf"), bytes);
  };

  /** A clock that only moves when the add sleeps; opens are recorded with the sentinel's presence. */
  const depsWith = (overrides: Partial<AddDeps>) => {
    const sleeps: number[] = [];
    const opened: { url: string; sentinel: boolean }[] = [];
    let time = 0;

    const deps: AddDeps = {
      openExternal: async (url) => {
        opened.push({ url, sentinel: existsSync(sentinel()) });
        await Promise.resolve();
      },
      readSteam,
      sleep: async (ms) => {
        sleeps.push(ms);
        time += ms;
        await Promise.resolve();
      },
      now: () => time,
      tmpDir: tmp,
      ...overrides,
    };

    return { deps, opened, sleeps };
  };

  /** Steam writes user 222's shortcut when the URL opens; user 111 has none. */
  const steamAddsOnOpen = () => {
    fakeSteamRoot(home, { "111": [], "222": null });

    const opened: { url: string; sentinel: boolean }[] = [];

    const { deps } = depsWith({
      openExternal: async (url) => {
        opened.push({ url, sentinel: existsSync(sentinel()) });
        await writeShortcuts("222", encodeShortcuts([ours()]));
      },
    });

    return { deps, opened };
  };

  /** An add that Steam does not answer in time: it leaves the launcher and owes the art. */
  const timedOutAdd = async () => {
    fakeSteamRoot(home, { "111": [], "222": [] });

    await expect(addToSteam(place(), depsWith({}).deps)).resolves.toStrictEqual({
      state: "timedOut",
    });
  };

  describe(addToSteam, () => {
    it("adds: script, .desktop, sentinel present while the URL opens, art under the read-back ID, sentinel gone", async () => {
      const { deps, opened } = steamAddsOnOpen();

      await expect(addToSteam(place(), deps)).resolves.toStrictEqual({ state: "added" });

      expect(opened).toStrictEqual([
        { url: `steam://addnonsteamgame/${encodeURIComponent(files().desktop)}`, sentinel: true },
      ]);
      expect(readdirSync(grid("222")).toSorted()).toStrictEqual([
        "3141592653.png",
        "3141592653_hero.png",
        "3141592653_logo.png",
        "3141592653p.png",
      ]);
      expect(existsSync(grid("111"))).toBe(false);
      expect(existsSync(sentinel())).toBe(false);
    });

    it("writes the launcher and logs what Steam listed", async () => {
      const { deps } = steamAddsOnOpen();

      const records = await recording(async () => {
        await addToSteam(place(), deps);
      });

      await expect(readFile(files().script, "utf-8")).resolves.toBe(launcherScript(TARGET));
      expect(existsSync(files().desktop)).toBe(true);
      expect(at(records, "info")).toStrictEqual([
        "Asked the launcher to add {desktop}",
        "The launcher listed harakiri as {appId} for user {user}; wrote {written}",
      ]);
      expect(records.at(-1)?.properties).toStrictEqual({
        appId: APP_ID,
        user: "222",
        written: ALL_ART,
      });
    });

    it("Steam lists it on the third poll", async () => {
      fakeSteamRoot(home, { "222": [] });

      let reads = 0;

      const { deps, sleeps } = depsWith({
        readSteam: async () => {
          reads += 1;

          if (reads === 3) {
            await writeShortcuts("222", encodeShortcuts([ours()]));
          }

          return await readSteam();
        },
      });

      await expect(addToSteam(place(), deps)).resolves.toStrictEqual({ state: "added" });

      expect(reads).toBe(3);
      expect(sleeps).toStrictEqual([500, 500]);
      expect(POLL_MS).toBe(500);
      expect(readdirSync(grid("222"))).toHaveLength(4);
    });

    it("times out after 30 s and leaves the launcher for a later heal", async () => {
      fakeSteamRoot(home, { "222": [] });

      const { deps, sleeps } = depsWith({});

      await expect(addToSteam(place(), deps)).resolves.toStrictEqual({ state: "timedOut" });

      expect(TIMEOUT_MS).toBe(30_000);
      expect(sleeps).toStrictEqual(Array.from({ length: 60 }, () => 500));
      expect([existsSync(files().script), existsSync(files().desktop)]).toStrictEqual([true, true]);
      expect([existsSync(sentinel()), existsSync(grid("222"))]).toStrictEqual([false, false]);
    });

    it("logs a time out", async () => {
      fakeSteamRoot(home, { "222": [] });

      const { deps } = depsWith({});

      const records = await recording(async () => {
        await addToSteam(place(), deps);
      });

      expect(at(records, "info")).toStrictEqual([
        "Asked the launcher to add {desktop}",
        "The launcher did not list harakiri within {ms} ms",
      ]);
      expect(records.at(-1)?.properties).toStrictEqual({ ms: 30_000 });
    });

    it("a sentinel that was already there stays", async () => {
      fakeSteamRoot(home, { "222": [ours()] });
      await writeFile(sentinel(), "someone else's");

      const { deps, opened } = depsWith({});

      await expect(addToSteam(place(), deps)).resolves.toStrictEqual({ state: "added" });

      expect(opened.map((open) => open.sentinel)).toStrictEqual([true]);
      await expect(readFile(sentinel(), "utf-8")).resolves.toBe("someone else's");
    });

    it("a broken shortcuts.vdf mid-poll is skipped, not fatal", async () => {
      fakeSteamRoot(home, { "222": [] });

      const valid = encodeShortcuts([ours()]);
      let reads = 0;

      const { deps, sleeps } = depsWith({
        readSteam: async () => {
          reads += 1;
          await writeShortcuts("222", reads === 1 ? valid.slice(0, 40) : valid);

          return await readSteam();
        },
      });

      let result: unknown;

      const records = await recording(async () => {
        result = await addToSteam(place(), deps);
      });

      expect(result).toStrictEqual({ state: "added" });
      expect(sleeps).toStrictEqual([500]);
      expect(at(records, "warning")).toStrictEqual([
        "Steam's shortcuts file {file} could not be read: {reason}",
      ]);
      expect(readdirSync(grid("222"))).toHaveLength(4);
    });

    it("no AppImage fails with the reason and touches nothing", async () => {
      fakeSteamRoot(home, { "222": [] });

      const { deps, opened } = depsWith({});

      await expect(addToSteam({ ...place(), target: undefined }, deps)).resolves.toStrictEqual({
        state: "failed",
        reason: "harakiri is not running from its AppImage",
      });

      expect(existsSync(files().dir)).toBe(false);
      expect(existsSync(sentinel())).toBe(false);
      expect(opened).toStrictEqual([]);
    });

    it("a URL the desktop cannot open fails with its message, sentinel removed", async () => {
      fakeSteamRoot(home, { "222": [] });

      let reads = 0;

      const { deps } = depsWith({
        openExternal: async () => {
          await Promise.reject(new Error("No application handles steam:"));
        },
        readSteam: async () => {
          reads += 1;

          return await readSteam();
        },
      });

      await expect(addToSteam(place(), deps)).resolves.toStrictEqual({
        state: "failed",
        reason: "No application handles steam:",
      });

      expect(existsSync(sentinel())).toBe(false);
      expect(reads).toBe(0);
    });

    it("a launcher that cannot be written fails with the error, before the URL opens", async () => {
      fakeSteamRoot(home, { "222": [] });

      const missing = path.join(root, "no-art");
      const { deps, opened } = depsWith({});

      await expect(addToSteam({ ...place(), artwork: missing }, deps)).resolves.toStrictEqual({
        state: "failed",
        reason: `ENOENT: no such file or directory, open '${path.join(missing, "icon.png")}'`,
      });

      expect(opened).toStrictEqual([]);
      expect(existsSync(sentinel())).toBe(false);
    });
  });

  describe(steamLauncherState, () => {
    // The state never touches userData, so a fixed one names the script the shortcut points at.
    const fixed: LauncherPlace = {
      files: launcherFiles("/data/harakiri"),
      target: TARGET,
      artwork: ARTWORK,
    };

    const fixedOurs: ShortcutEntry = {
      appId: APP_ID,
      appName: "harakiri",
      exe: `"${fixed.files.script}"`,
    };

    it.each([
      ["no Steam", {}, TARGET, "unavailable"],
      ["Steam, no AppImage", { "1": null }, undefined, "unavailable"],
      ["Steam", { "1": null }, TARGET, "offered"],
      ["Steam with our shortcut", { "1": [fixedOurs] }, TARGET, "added"],
    ] as const)("state: %s", async (_name, users, target, state) => {
      fakeSteamRoot(home, users);

      expect(steamLauncherState(await readSteam(), { ...fixed, target })).toBe(state);
    });
  });

  describe("the heal at startup", () => {
    it("rewrites a launcher whose AppImage moved, and writes no art", async () => {
      fakeSteamRoot(home, { "111": [], "222": [ours()] });
      await writeLauncher(files(), "/opt/old.AppImage", ARTWORK);

      await expect(healSteamLauncher(place(), await readSteam())).resolves.toStrictEqual({
        launcher: "rewritten",
        artwork: [],
      });

      await expect(readFile(files().script, "utf-8")).resolves.toBe(launcherScript(TARGET));
      expect([existsSync(grid("111")), existsSync(grid("222"))]).toStrictEqual([false, false]);
    });

    it("writes a launcher Steam points at even when userData lost it", async () => {
      fakeSteamRoot(home, { "222": [ours()] });

      await expect(healSteamLauncher(place(), await readSteam())).resolves.toStrictEqual({
        launcher: "rewritten",
        artwork: [],
      });

      await expect(readFile(files().script, "utf-8")).resolves.toBe(launcherScript(TARGET));
      expect([existsSync(files().desktop), existsSync(files().icon)]).toStrictEqual([true, true]);
    });

    it("does nothing without a launcher or a shortcut", async () => {
      fakeSteamRoot(home, { "222": [] });

      await expect(healSteamLauncher(place(), await readSteam())).resolves.toStrictEqual({
        launcher: "absent",
        artwork: [],
      });

      expect(existsSync(files().dir)).toBe(false);
      expect(existsSync(grid("222"))).toBe(false);
    });

    it("does nothing without an AppImage", async () => {
      fakeSteamRoot(home, { "222": [ours()] });

      await expect(
        healSteamLauncher({ ...place(), target: undefined }, await readSteam())
      ).resolves.toStrictEqual({ launcher: "no-target", artwork: [] });

      expect(existsSync(files().dir)).toBe(false);
      expect(existsSync(grid("222"))).toBe(false);
    });

    it("adds art Steam listed after a timed-out add, and keeps custom art", async () => {
      await timedOutAdd();
      await writeShortcuts("222", encodeShortcuts([ours()]));
      await mkdir(grid("222"), { recursive: true });
      await writeFile(path.join(grid("222"), "3141592653_hero.jpg"), "custom");

      await expect(healSteamLauncher(place(), await readSteam())).resolves.toStrictEqual({
        launcher: "unchanged",
        artwork: [
          { user: "222", written: ["3141592653p.png", "3141592653.png", "3141592653_logo.png"] },
        ],
      });

      await expect(readFile(path.join(grid("222"), "3141592653_hero.jpg"), "utf-8")).resolves.toBe(
        "custom"
      );
      expect(existsSync(path.join(grid("222"), "3141592653_hero.png"))).toBe(false);
      expect(existsSync(grid("111"))).toBe(false);
    });

    it("writes the art a timed-out add owed once: art removed afterwards stays removed", async () => {
      await timedOutAdd();
      await writeShortcuts("222", encodeShortcuts([ours()]));

      await expect(healSteamLauncher(place(), await readSteam())).resolves.toStrictEqual({
        launcher: "unchanged",
        artwork: [{ user: "222", written: ALL_ART }],
      });

      await rm(path.join(grid("222"), "3141592653p.png"));

      await expect(healSteamLauncher(place(), await readSteam())).resolves.toStrictEqual({
        launcher: "unchanged",
        artwork: [],
      });
      expect(existsSync(path.join(grid("222"), "3141592653p.png"))).toBe(false);
    });

    it("a timed-out add that Steam still does not list keeps its art owed", async () => {
      await timedOutAdd();

      await expect(healSteamLauncher(place(), await readSteam())).resolves.toStrictEqual({
        launcher: "unchanged",
        artwork: [],
      });

      await writeShortcuts("222", encodeShortcuts([ours()]));

      await expect(healSteamLauncher(place(), await readSteam())).resolves.toStrictEqual({
        launcher: "unchanged",
        artwork: [{ user: "222", written: ALL_ART }],
      });
    });

    it("never restores art the owner removed after an add", async () => {
      const { deps } = steamAddsOnOpen();

      await expect(addToSteam(place(), deps)).resolves.toStrictEqual({ state: "added" });
      await rm(path.join(grid("222"), "3141592653_hero.png"));
      await rm(path.join(grid("222"), "3141592653_logo.png"));

      await expect(healSteamLauncher(place(), await readSteam())).resolves.toStrictEqual({
        launcher: "unchanged",
        artwork: [],
      });
      expect(readdirSync(grid("222")).toSorted()).toStrictEqual([
        "3141592653.png",
        "3141592653p.png",
      ]);
    });

    it("a later add that Steam lists pays the art a timed-out one owed", async () => {
      await timedOutAdd();
      const { deps } = steamAddsOnOpen();

      await expect(addToSteam(place(), deps)).resolves.toStrictEqual({ state: "added" });
      await rm(path.join(grid("222"), "3141592653_hero.png"));

      await expect(healSteamLauncher(place(), await readSteam())).resolves.toStrictEqual({
        launcher: "unchanged",
        artwork: [],
      });
    });

    it("warns and resolves when nothing can be written, and still owes the art", async () => {
      await timedOutAdd();
      await writeShortcuts("222", encodeShortcuts([ours()]));

      const missing = path.join(root, "no-art");
      let report: unknown;

      const records = await recording(async () => {
        report = await healSteamLauncher({ ...place(), artwork: missing }, await readSteam());
      });

      expect(report).toStrictEqual({
        launcher: "unchanged",
        artwork: [{ user: "222", written: [] }],
      });
      expect(at(records, "warning")).toStrictEqual([
        "The launcher could not be rewritten: {error}",
        "Art for user {user} could not be written: {error}",
      ]);

      await expect(healSteamLauncher(place(), await readSteam())).resolves.toStrictEqual({
        launcher: "unchanged",
        artwork: [{ user: "222", written: ALL_ART }],
      });
    });
  });
});
