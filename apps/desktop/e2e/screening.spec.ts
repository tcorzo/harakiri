import type { Page } from "@playwright/test";

import {
  cardName,
  expect,
  expectFocus,
  focusRoute,
  isRunning,
  playerEvents,
  playerEventUntil,
  probeUntil,
  recordPlayerEvents,
  test,
  until,
  waitForNoMpv,
} from "./support/harakiri";
import { minutesLeft, spokenTitle, TICKS_PER_SECOND } from "./support/jellyfin";
import { leadContinueWatching, main, openFirstResumed } from "./support/library";
import { mpvProcesses, pressKey } from "./support/mpv";

interface StationSeen {
  readonly station: string;
  readonly at: number;
}

declare global {
  interface Window {
    harakiriE2eStations?: StationSeen[];
  }
}

/** Records every handoff station the screening shows, with when it appeared. */
const recordStations = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const seen: StationSeen[] = [];
    window.harakiriE2eStations = seen;

    const record = (): void => {
      const station = document.querySelector<HTMLElement>("main[data-station]")?.dataset.station;

      if (station !== undefined && seen.at(-1)?.station !== station) {
        seen.push({ station, at: performance.now() });
      }
    };

    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-station"],
    });
  });
};

const stations = async (page: Page) => {
  const seen = await page.evaluate(() => window.harakiriE2eStations ?? []);

  return seen.map((s) => s.station);
};

const ticks = (seconds: number) => seconds * TICKS_PER_SECOND;

test.beforeEach(({ signIn }) => {
  signIn();
});

test("Play from the title page: House, Programme, Picture, then mpv plays the item from its resume point, and stopping lands back on an updated Resume", async ({
  launch,
  jellyfin,
  userDataDir,
  preserveUserData,
  backend,
}) => {
  const { item, shown } = await leadContinueWatching(jellyfin, preserveUserData, 60);
  const leftBefore = minutesLeft(shown);
  expect(leftBefore).not.toBeNull();
  const { page } = await launch();
  await openFirstResumed(page, shown);
  await expect(page.getByRole("button", { name: `Resume ${shown.Name}` })).toHaveText(
    `Resume · ${leftBefore} min left`
  );
  await recordPlayerEvents(page);
  await recordStations(page);

  await page.keyboard.press("Enter");
  await expect(main(page, `Screening ${shown.Name}`)).toBeVisible();
  await expect(page.getByText("Press Back to cancel.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Picture" })).not.toHaveAttribute(
    "aria-current",
    "step"
  );

  // mpv runs the item the server named, as a direct stream, from the resume point.
  const running = await probeUntil(page, (p) => p.running && (p.timePos ?? 0) >= 60, 20_000);
  expect(running.path).toBe(
    new URL(
      `Videos/${item.id}/stream?static=true&MediaSourceId=${item.mediaSourceId}`,
      backend.server
    ).href
  );
  expect(running.timePos ?? 0).toBeLessThan(75);
  expect(mpvProcesses(userDataDir)).toHaveLength(1);
  await expect(page.getByText("Now screening in the player. Press Back to stop.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Picture" })).toHaveAttribute(
    "aria-current",
    "step"
  );

  // The stations came in order and each held for its beat (House 1200 ms, Programme 3000 ms).
  const seen = await page.evaluate(() => window.harakiriE2eStations ?? []);
  expect(seen.map((s) => s.station)).toEqual(["House", "Programme", "Picture"]);
  const [house, programme, picture] = seen;

  if (house === undefined || programme === undefined || picture === undefined) {
    throw new Error("unreachable: three stations were asserted above");
  }

  expect(programme.at - house.at).toBeGreaterThanOrEqual(1100);
  expect(picture.at - programme.at).toBeGreaterThanOrEqual(2900);

  // Three skips forward of 30 s, then Back in mpv, as a remote pointed at the player would.
  const from = running.timePos ?? 60;

  /* oxlint-disable eslint/no-await-in-loop -- the skips are ordered key presses */
  for (let i = 0; i < 3; i += 1) {
    await pressKey(userDataDir, "RIGHT");
  }
  /* oxlint-enable eslint/no-await-in-loop */

  await probeUntil(page, (p) => (p.timePos ?? 0) >= from + 85);
  await pressKey(userDataDir, "ESC");
  const stopped = await playerEventUntil(page, (event) => event.phase === "stopped");
  expect(stopped.itemId).toBe(item.id);
  expect(stopped.positionTicks).toBeGreaterThanOrEqual(ticks(from + 85));
  expect(await waitForNoMpv(userDataDir, 5000)).toEqual([]);

  // Back on the title page, Resume focused and naming the time left from the server's new resume point.
  const saved = await until(
    "the server stores the new resume point",
    async () => await jellyfin.item(item.id),
    (data) => (data.UserData?.PlaybackPositionTicks ?? 0) >= ticks(from + 85),
    5000
  );

  const leftAfter = minutesLeft(saved);
  expect(leftAfter).not.toBeNull();
  expect(leftAfter).not.toBe(leftBefore);
  expect(await focusRoute(page, `Resume ${shown.Name}`, 10_000)).toBe(`/title/${item.id}`);
  await expect(page.getByRole("button", { name: `Resume ${shown.Name}` })).toHaveText(
    `Resume · ${leftAfter} min left`
  );

  // Back to the library: focus on the card it was opened from, still leading Continue Watching.
  await page.keyboard.press("Escape");
  const card = await expectFocus(page, cardName(spokenTitle(saved)));
  expect(card.section).toBe("Continue Watching");

  const first = page
    .getByRole("region", { name: "Continue Watching", exact: true })
    .getByRole("button")
    .first();

  await expect(first).toHaveAccessibleName(cardName(spokenTitle(saved)));
  await expect(first).toContainText(`${leftAfter} min left`);
  const [leading] = await jellyfin.resumeIds();
  expect(leading).toBe(item.id);
});

// oxlint-disable-next-line vitest/prefer-each -- Playwright has no test.each; a loop is how it parametrizes
for (const station of ["House", "Programme"] as const) {
  test(`Back during ${station} cancels the screening: no mpv starts and Resume has focus again`, async ({
    launch,
    jellyfin,
    userDataDir,
    preserveUserData,
  }) => {
    const { shown } = await leadContinueWatching(jellyfin, preserveUserData);
    const { page } = await launch();
    await openFirstResumed(page, shown);
    await recordPlayerEvents(page);
    await recordStations(page);

    await page.keyboard.press("Enter");
    await until(
      `the handoff reaches ${station}`,
      async () => await stations(page),
      (s) => s.at(-1) === station,
      6000,
      50
    );
    await page.keyboard.press("Escape");

    expect(await focusRoute(page, `Resume ${shown.Name}`, 10_000)).toBe(`/title/${shown.Id}`);
    // Past the moment the picture would have been handed to mpv (1.2 s + 3 s).
    await page.waitForTimeout(4500);
    expect(mpvProcesses(userDataDir)).toEqual([]);
    expect(await playerEvents(page)).toEqual([]);
    expect(await isRunning(page)).toBe(false);
    expect(await stations(page)).not.toContain("Picture");
    await expectFocus(page, `Resume ${shown.Name}`);
  });
}
