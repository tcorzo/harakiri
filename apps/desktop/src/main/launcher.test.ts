import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { artworkDir } from "./host";
import { fakeSteamRoot } from "./host/fixtures/steam-root";
import { encodeShortcuts } from "./host/steam/fixtures/vdf";
import { launcherFiles } from "./host/steam/launcher";
import { createLauncher } from "./launcher";

const ARTWORK = artworkDir({
  packaged: false,
  resourcesPath: "/unused",
  mainDir: import.meta.dirname,
});

const idle = async (): Promise<void> => {
  await Promise.resolve();
};

const TARGET = "/opt/h.AppImage";
const APP_ID = 3_141_592_653;

describe(createLauncher, () => {
  let root = "";
  let home = "";
  let userData = "";
  let tmp = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "harakiri-launcher-"));
    home = path.join(root, "home");
    userData = path.join(root, "userData");
    tmp = path.join(root, "tmp");
    await mkdir(tmp);
    await mkdir(userData);
    vi.stubEnv("HOME", home);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await chmod(userData, 0o700);
    await rm(root, { recursive: true, force: true });
  });

  const ours = () => ({
    appId: APP_ID,
    appName: "harakiri",
    exe: `"${launcherFiles(userData).script}"`,
  });

  const writeOurShortcut = async () => {
    await writeFile(
      path.join(home, ".local", "share", "Steam", "userdata", "222", "config", "shortcuts.vdf"),
      encodeShortcuts([ours()])
    );
  };

  const build = (
    openExternal: (url: string) => Promise<void>,
    options: { readonly target?: string | null } = {}
  ) =>
    createLauncher({
      where: () => ({
        userData,
        target: options.target === null ? undefined : (options.target ?? TARGET),
        artwork: ARTWORK,
      }),
      openExternal,
      tmpDir: tmp,
    });

  it("two presses while one add runs open the URL once and share the result", async () => {
    fakeSteamRoot(home, { "222": [] });

    const opened: string[] = [];
    const gate = Promise.withResolvers<null>();

    const launcher = build(async (url) => {
      opened.push(url);
      await gate.promise;
      await writeOurShortcut();
    });

    const first = launcher.add();
    const second = launcher.add();
    gate.resolve(null);

    await expect(Promise.all([first, second])).resolves.toStrictEqual([
      { state: "added" },
      { state: "added" },
    ]);
    expect(opened).toHaveLength(1);
  });

  it("after one add settles, a press with the launcher already listing it opens nothing", async () => {
    fakeSteamRoot(home, { "222": [] });

    const opened: string[] = [];

    const launcher = build(async (url) => {
      opened.push(url);
      await writeOurShortcut();
    });

    await expect(launcher.add()).resolves.toStrictEqual({ state: "added" });
    await expect(launcher.add()).resolves.toStrictEqual({ state: "added" });
    expect(opened).toHaveLength(1);
  });

  it("a failed add does not hold the launcher: the next press runs again", async () => {
    fakeSteamRoot(home, { "222": [] });

    let calls = 0;

    const launcher = build(async () => {
      calls += 1;

      if (calls === 1) {
        throw new Error("no handler");
      }

      await writeOurShortcut();
    });

    await expect(launcher.add()).resolves.toMatchObject({ state: "failed" });
    await expect(launcher.add()).resolves.toStrictEqual({ state: "added" });
  });

  it("add refuses without a launcher install, and writes and opens nothing", async () => {
    const opened: string[] = [];

    await expect(
      build(async (url) => {
        opened.push(url);
        await idle();
      }).add()
    ).resolves.toStrictEqual({ state: "failed", reason: "no Steam library was found" });
    expect(opened).toStrictEqual([]);
    expect(existsSync(launcherFiles(userData).dir)).toBe(false);
  });

  it("add refuses without an AppImage, and opens nothing", async () => {
    fakeSteamRoot(home, { "222": [] });

    const opened: string[] = [];

    await expect(
      build(
        async (url) => {
          opened.push(url);
          await idle();
        },
        { target: null }
      ).add()
    ).resolves.toStrictEqual({
      state: "failed",
      reason: "harakiri is not running from its AppImage",
    });
    expect(opened).toStrictEqual([]);
  });

  it("status carries the launcher's name and its words for the desktop", async () => {
    fakeSteamRoot(home, { "222": [] });
    vi.stubEnv("GAMESCOPE_WAYLAND_DISPLAY", "");

    await expect(build(idle).status()).resolves.toStrictEqual({
      state: "offered",
      name: "Steam",
      launchHint: "Launch it from there in Game Mode.",
      retryHint: "Open Steam, then try again.",
    });
  });

  it("inside Game Mode the words do not send the owner to Game Mode or to open Steam", async () => {
    fakeSteamRoot(home, { "222": [] });
    vi.stubEnv("GAMESCOPE_WAYLAND_DISPLAY", "gamescope-0");

    await expect(build(idle).status()).resolves.toStrictEqual({
      state: "offered",
      name: "Steam",
      launchHint: "Launch it from there next time.",
      retryHint: "Try again in a moment.",
    });
  });

  it("status is added once the launcher lists harakiri", async () => {
    fakeSteamRoot(home, { "222": [ours()] });

    await expect(build(idle).status()).resolves.toStrictEqual({
      state: "added",
      name: "Steam",
    });
  });

  it("status is unavailable without a launcher install or without an AppImage", async () => {
    await expect(build(idle).status()).resolves.toStrictEqual({
      state: "unavailable",
    });

    fakeSteamRoot(home, { "222": [] });

    await expect(build(idle, { target: null }).status()).resolves.toStrictEqual({
      state: "unavailable",
    });
  });

  it("healAtStart never rejects, even when userData is unwritable", async () => {
    fakeSteamRoot(home, { "222": [ours()] });
    await chmod(userData, 0o500);

    await expect(build(idle).healAtStart()).resolves.toBeUndefined();
  });
});
