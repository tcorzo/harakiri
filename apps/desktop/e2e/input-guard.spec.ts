import { writeFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { plugPad, setAxis, setButton, tap } from "./support/gamepad";
import type { Button } from "./support/gamepad";
import {
  cardName,
  expect,
  expectFocus,
  focusRoute,
  isRunning,
  playerEventUntil,
  playerPhases,
  probe,
  probeUntil,
  recordPlayerEvents,
  test,
  until,
  waitForNoMpv,
} from "./support/harakiri";
import { spokenTitle } from "./support/jellyfin";
import type { ShownItem } from "./support/jellyfin";
import { leadContinueWatching, main, openFirstResumed } from "./support/library";
import { mpvProcesses, pressKey } from "./support/mpv";

/** Title page, Play, and the handoff all the way to mpv playing; returns mpv's pid. */
const startScreening = async (
  page: Page,
  shown: ShownItem,
  userDataDir: string
): Promise<number> => {
  await openFirstResumed(page, shown);
  await recordPlayerEvents(page);
  await page.keyboard.press("Enter");
  await expect(main(page, `Screening ${shown.Name}`)).toBeVisible();
  const started = await probeUntil(page, (p) => p.running && (p.timePos ?? 0) > 0, 20_000);
  await probeUntil(page, (p) => (p.timePos ?? 0) >= (started.timePos ?? 0) + 1);
  const [mpv, ...others] = mpvProcesses(userDataDir);

  if (mpv === undefined || others.length > 0) {
    throw new Error("Expected exactly one mpv");
  }

  return mpv.pid;
};

/** Nothing the renderer received moved it: same screen, same single mpv still playing, one start, no stop. */
const expectUntouched = async (page: Page, shown: ShownItem, userDataDir: string, pid: number) => {
  const { timePos } = await probe(page);
  const before = timePos ?? 0;
  await page.waitForTimeout(800);
  await expect(main(page, `Screening ${shown.Name}`)).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toMatch(
    new RegExp(`^#/screening/${shown.Id}`, "u")
  );
  expect(mpvProcesses(userDataDir).map((p) => p.pid)).toEqual([pid]);
  const now = await probe(page);
  expect(now.running).toBe(true);
  expect(now.pause).toBe(false);
  expect(now.timePos ?? 0).toBeGreaterThan(before);
  const phases = await playerPhases(page);
  expect(phases.filter((phase) => phase === "starting")).toHaveLength(1);
  expect(phases).not.toContain("stopped");
};

const stopInMpv = async (page: Page, shown: ShownItem, userDataDir: string): Promise<void> => {
  await pressKey(userDataDir, "ESC");
  await playerEventUntil(page, (event) => event.phase === "stopped");
  expect(await waitForNoMpv(userDataDir, 5000)).toEqual([]);
  expect(await focusRoute(page, `Resume ${shown.Name}`, 10_000)).toBe(`/title/${shown.Id}`);
};

test.beforeEach(({ signIn }) => {
  signIn();
});

test("while mpv plays, every pad button reaches nothing in the renderer; once it stops the pad works again", async ({
  launch,
  jellyfin,
  userDataDir,
  preserveUserData,
}) => {
  const { shown } = await leadContinueWatching(jellyfin, preserveUserData);
  const { page } = await launch();
  const pid = await startScreening(page, shown, userDataDir);
  await plugPad(page);

  // A would press Play again, B would stop mpv from the renderer, the d-pad would move focus.
  const buttons: Button[] = ["a", "b", "y", "view", "start", "up", "down", "left", "right"];

  /* oxlint-disable eslint/no-await-in-loop -- each press must land and settle before the next */
  for (const button of buttons) {
    await tap(page, button);
  }
  /* oxlint-enable eslint/no-await-in-loop */

  await setAxis(page, 0, 0.9);
  await setAxis(page, 0, 0);
  await setAxis(page, 1, 0.9);
  await setAxis(page, 1, 0);
  await expectUntouched(page, shown, userDataDir, pid);

  await stopInMpv(page, shown, userDataDir);
  await tap(page, "right");
  await expectFocus(page, "Play from the start");
  await tap(page, "left");
  await expectFocus(page, `Resume ${shown.Name}`);
  await tap(page, "b");
  expect(await focusRoute(page, cardName(spokenTitle(shown)))).toBe("/library");
});

test("a B still held when playback ends stays silent until it is released", async ({
  launch,
  jellyfin,
  userDataDir,
  preserveUserData,
}) => {
  const { shown } = await leadContinueWatching(jellyfin, preserveUserData);
  const { page } = await launch();
  const pid = await startScreening(page, shown, userDataDir);
  await plugPad(page);

  // The owner holds B in mpv; mpv's own binding stops playback while it is still down.
  await setButton(page, "b", true);
  await expectUntouched(page, shown, userDataDir, pid);
  await stopInMpv(page, shown, userDataDir);
  await page.waitForTimeout(800);
  expect(await focusRoute(page, `Resume ${shown.Name}`)).toBe(`/title/${shown.Id}`);

  await setButton(page, "b", false);
  await tap(page, "b");
  expect(await focusRoute(page, cardName(spokenTitle(shown)))).toBe("/library");
});

test("while mpv plays, renderer keys neither navigate nor play again, and Back stops as the screen says", async ({
  launch,
  jellyfin,
  userDataDir,
  preserveUserData,
}) => {
  const { shown } = await leadContinueWatching(jellyfin, preserveUserData);
  const { page } = await launch();
  const pid = await startScreening(page, shown, userDataDir);

  // The keyboard is not guarded (only mpv reads the pad); with no control on screen these keys do nothing.
  /* oxlint-disable eslint/no-await-in-loop -- key presses are ordered */
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "]) {
    await page.keyboard.press(key);
  }
  /* oxlint-enable eslint/no-await-in-loop */

  await expectUntouched(page, shown, userDataDir, pid);

  await expect(page.getByText("Now screening in the player. Press Back to stop.")).toBeVisible();
  await page.keyboard.press("Escape");
  const stopped = await playerEventUntil(page, (event) => event.phase === "stopped");
  expect(stopped.itemId).toBe(shown.Id);
  expect(await waitForNoMpv(userDataDir, 5000)).toEqual([]);
  expect(await focusRoute(page, `Resume ${shown.Name}`, 10_000)).toBe(`/title/${shown.Id}`);
});

test.describe("with mpv holding the file until the test lets it load", () => {
  test.use({
    mpvArgs: `--vo=null --ao=null --script=${path.resolve(import.meta.dirname, "support/hold-load.lua")}`,
  });

  test("B in the moment between the Picture station and mpv taking the file still cancels", async ({
    launch,
    jellyfin,
    userDataDir,
    preserveUserData,
  }) => {
    const { shown } = await leadContinueWatching(jellyfin, preserveUserData);
    const { page } = await launch();
    await openFirstResumed(page, shown);
    await plugPad(page);
    await page.keyboard.press("Enter");
    await expect(page.locator('main[data-station="Picture"]')).toBeVisible({ timeout: 6000 });
    // mpv is up but holds the file, so the play has not resolved and the renderer still owns the pad.
    await until(
      "mpv starts",
      () => mpvProcesses(userDataDir),
      (alive) => alive.length === 1
    );
    expect(await isRunning(page)).toBe(false);

    await tap(page, "b");
    writeFileSync(path.join(userDataDir, "mpv", "release"), "");

    expect(await focusRoute(page, `Resume ${shown.Name}`, 15_000)).toBe(`/title/${shown.Id}`);
    expect(await waitForNoMpv(userDataDir, 5000)).toEqual([]);
  });
});
