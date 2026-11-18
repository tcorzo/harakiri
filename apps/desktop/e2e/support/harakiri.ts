import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { ItemId, SessionData } from "@harakiri/jellyfin";
import { _electron, test as base, type ElectronApplication, type Page } from "@playwright/test";

import {
  type HarakiriBridge,
  PlayerEvent,
  PlayerProbe,
  type PlayRequest,
} from "../../src/shared/bridge";
import { type Backend, resolveBackend } from "./backend";
import { Jellyfin, seedSession, signInAccount, type UserData } from "./jellyfin";
import { mpvProcesses } from "./mpv";

declare global {
  interface Window {
    readonly harakiri: HarakiriBridge;
    harakiriE2eEvents?: unknown[];
  }
}

const electronPath: string = createRequire(import.meta.url)("electron");
const mainEntry = resolve(import.meta.dirname, "../../out/main/index.js");

export interface Launched {
  readonly app: ElectronApplication;
  readonly page: Page;
}

interface Options {
  /** HARAKIRI_MPV_ARGS for every app the test launches. */
  readonly mpvArgs: string;
  /** Extra environment for Electron and, through it, mpv (for example VK_DRIVER_FILES). */
  readonly extraEnv: Readonly<Record<string, string>>;
}

interface TestFixtures {
  /** The test's isolated HARAKIRI_USER_DATA dir, removed at teardown. */
  readonly userDataDir: string;
  /** Seeds the profile with this run's signed-in session, as if the user had onboarded. */
  readonly signIn: () => void;
  /** Every app the test launched; all are closed, and their mpvs checked gone, at teardown. */
  readonly apps: ElectronApplication[];
  /**
   * Records an item's resume state now and puts it back once every app has closed, so the next
   * test on the shared server starts on the same library.
   */
  readonly preserveUserData: (itemId: ItemId) => Promise<void>;
  /** Launches the built app on the profile. */
  readonly launch: () => Promise<Launched>;
  /**
   * Automatic: once every app has closed, revokes the token of an app that signed in through the
   * UI by deleting the profile's own device on the server. Settings' sign-out and the error
   * screen's Change server revoke the token themselves, but a test that ends signed in, or leaves
   * through Sign in again (which never sends a token the server refused), leaves it behind.
   */
  readonly revokeAppDevice: void;
}

interface WorkerFixtures {
  /** The Jellyfin: the e2e container on the corpus, or HARAKIRI_E2E_SERVER. */
  readonly backend: Backend;
  readonly account: SessionData;
  readonly jellyfin: Jellyfin;
}

export const test = base.extend<Options & TestFixtures, WorkerFixtures>({
  mpvArgs: ["--vo=null --ao=null", { option: true }],
  extraEnv: [{}, { option: true }],

  backend: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads the fixture's dependencies from this pattern
    async ({}, use) => {
      await use(resolveBackend());
    },
    { scope: "worker" },
  ],

  account: [
    async ({ backend }, use) => {
      await use(await signInAccount(backend));
    },
    { scope: "worker" },
  ],

  jellyfin: [
    async ({ account, backend }, use) => {
      const jellyfin = new Jellyfin(account, backend);
      await use(jellyfin);
      await jellyfin.signOut();
    },
    { scope: "worker" },
  ],

  // oxlint-disable-next-line no-empty-pattern -- Playwright reads the fixture's dependencies from this pattern
  userDataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), "harakiri-e2e-"));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },

  signIn: async ({ userDataDir, account }, use) => {
    await use(() => seedSession(userDataDir, account));
  },

  apps: async ({ userDataDir }, use) => {
    const apps: ElectronApplication[] = [];
    await use(apps);
    await closeAll(apps);
    // A leak fails the test and is killed, so it cannot leak into the next one.
    const leaked = await waitForNoMpv(userDataDir, 5000);

    for (const { pid } of leaked) {
      process.kill(pid, "SIGKILL");
    }

    if (leaked.length > 0) {
      throw new Error(`mpv outlived the app: pids ${leaked.map(({ pid }) => pid).join(", ")}`);
    }
  },

  preserveUserData: async ({ jellyfin, apps }, use) => {
    const saved = new Map<ItemId, UserData>();
    await use(async (itemId) => {
      if (!saved.has(itemId)) {
        saved.set(itemId, await jellyfin.userData(itemId));
      }
    });
    // An app quitting mid-playback reports a stop, which would overwrite a restored resume point.
    await closeAll(apps);

    for (const [itemId, data] of saved) {
      await jellyfin.setUserData(itemId, data);
    }
  },

  revokeAppDevice: [
    async ({ userDataDir, apps, account, jellyfin }, use) => {
      await use();
      await closeAll(apps);
      const file = join(userDataDir, "device-id");

      if (!existsSync(file)) {
        return;
      }
      const deviceId = readFileSync(file, "utf8").trim();

      // A seeded profile shares the worker's device, which the worker fixture signs out itself.
      if (deviceId === account.deviceId) {
        return;
      }

      // An app that never signed in left nothing on the server.
      if ((await jellyfin.deviceIds()).includes(deviceId)) {
        await jellyfin.deleteDevice(deviceId);
      }
    },
    { auto: true },
  ],

  launch: async ({ userDataDir, mpvArgs, extraEnv, apps }, use) => {
    // Without DISPLAY, Electron cannot fall back to the user's X session if the nested compositor is missing.
    // A terminal that is itself an AppImage exports APPIMAGE, which would switch the updater on.
    const dropped = new Set(["DISPLAY", "APPIMAGE"]);

    const inherited = Object.entries(process.env).filter(
      (entry): entry is [string, string] => !dropped.has(entry[0]) && entry[1] !== undefined
    );

    await use(async () => {
      const app = await _electron.launch({
        executablePath: electronPath,
        args: ["--ozone-platform=wayland", mainEntry],
        env: {
          ...Object.fromEntries(inherited),
          ...extraEnv,
          HARAKIRI_E2E: "1",
          HARAKIRI_USER_DATA: userDataDir,
          HARAKIRI_MPV_ARGS: mpvArgs,
        },
      });

      apps.push(app);
      const page = await app.firstWindow();
      await page.waitForFunction(() => window.harakiri !== undefined);

      return { app, page };
    });
  },
});

const closeAll = (apps: readonly ElectronApplication[]) =>
  Promise.all(apps.map((app) => app.close()));

export { expect } from "@playwright/test";

export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A card's accessible name: the spoken title, then optionally its catalogue number and "seen". */
export const cardName = (title: string): RegExp => new RegExp(`^${escapeRegExp(title)}(, |$)`);

/** The focused control as the owner meets it: its accessible name, and whether they can see it. */
export interface FocusedControl {
  readonly name: string;
  readonly tag: string;
  readonly inViewport: boolean;
  /** The product of every ancestor's computed opacity; 0 when any is hidden. */
  readonly opacity: number;
  readonly route: string;
  /** The labelled section around it: a programme row, "Tonight's screening", or null. */
  readonly section: string | null;
}

export function focusedControl(page: Page): Promise<FocusedControl | null> {
  return page.evaluate(() => {
    const el = document.activeElement;

    if (!(el instanceof HTMLElement) || el === document.body) {
      return null;
    }

    const label =
      el.getAttribute("aria-label") ??
      (el instanceof HTMLInputElement ? el.labels?.[0]?.textContent : null) ??
      el.textContent;

    const rect = el.getBoundingClientRect();
    let opacity = 1;

    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);

      if (style.visibility === "hidden" || style.display === "none") {
        opacity = 0;
      }
      opacity *= Number(style.opacity);
    }

    return {
      name: (label ?? "").trim(),
      tag: el.tagName.toLowerCase(),
      inViewport:
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth,
      opacity,
      route: decodeURIComponent(location.hash.replace(/^#/, "").split("?")[0] ?? ""),
      section: el.closest("section[aria-label]")?.getAttribute("aria-label") ?? null,
    };
  });
}

/**
 * Waits until focus rests on a visible, labelled control named `name` (any name when omitted) and
 * returns it. Focus on the body, on a control scrolled away, or on one faded out counts as lost.
 */
export async function expectFocus(
  page: Page,
  name?: string | RegExp,
  timeoutMs = 5000
): Promise<FocusedControl> {
  const found = await until(
    `focus rests on a visible control${name === undefined ? "" : ` named ${String(name)}`}`,
    () => focusedControl(page),
    (control) =>
      control !== null &&
      control.name !== "" &&
      control.inViewport &&
      control.opacity > 0.99 &&
      (name === undefined ||
        (typeof name === "string" ? control.name === name : name.test(control.name))),
    timeoutMs,
    50
  );

  if (found === null) {
    throw new Error("unreachable: until() returned without a focused control");
  }

  return found;
}

/** Polls `read` until `predicate` holds and returns that value; the error carries the last one. */
export async function until<T>(
  what: string,
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 15_000,
  intervalMs = 200
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await read();

  while (!predicate(last)) {
    if (Date.now() > deadline) {
      throw new Error(`${what}: not within ${timeoutMs} ms; last ${JSON.stringify(last)}`);
    }

    await sleep(intervalMs);
    last = await read();
  }

  return last;
}

/** Resolves with the mpvs still alive once none are left or the timeout passes. */
export async function waitForNoMpv(userDataDir: string, timeoutMs: number) {
  return until(
    "mpv exits",
    async () => mpvProcesses(userDataDir),
    (alive) => alive.length === 0,
    timeoutMs
  ).catch(() => mpvProcesses(userDataDir));
}

export async function probe(page: Page): Promise<PlayerProbe> {
  return PlayerProbe.parse(
    await page.evaluate(() => {
      if (!window.harakiri.test) {
        throw new Error("window.harakiri.test is missing without HARAKIRI_E2E=1");
      }

      return window.harakiri.test.probe();
    })
  );
}

/** Polls `window.harakiri.test.probe()` until `predicate` holds, and returns that probe. */
export const probeUntil = (
  page: Page,
  predicate: (probe: PlayerProbe) => boolean,
  timeoutMs = 15_000
): Promise<PlayerProbe> => until("probe matches", () => probe(page), predicate, timeoutMs);

/** Calls the bridge's play exactly as the renderer does. */
export const play = (page: Page, request: PlayRequest): Promise<void> =>
  page.evaluate((r) => window.harakiri.player.play(r), request);

export const stop = (page: Page): Promise<void> =>
  page.evaluate(() => window.harakiri.player.stop());

/** Starts recording every PlayerEvent the renderer receives through the bridge. */
export async function recordPlayerEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const events: unknown[] = [];
    window.harakiriE2eEvents = events;
    window.harakiri.player.onEvent((event) => events.push(event));
  });
}

export async function playerEvents(page: Page): Promise<PlayerEvent[]> {
  const raw = await page.evaluate(() => window.harakiriE2eEvents ?? []);

  return raw.map((event) => PlayerEvent.parse(event));
}

/** Waits for the first recorded event that matches, and returns it. */
export async function playerEventUntil(
  page: Page,
  predicate: (event: PlayerEvent) => boolean,
  timeoutMs = 15_000
): Promise<PlayerEvent> {
  const events = await until(
    "a matching player event arrives",
    () => playerEvents(page),
    (seen) => seen.some(predicate),
    timeoutMs
  );

  const found = events.find(predicate);

  if (!found) {
    throw new Error("unreachable: until() returned without a match");
  }

  return found;
}
