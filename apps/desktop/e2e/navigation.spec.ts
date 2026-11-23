import type { Page } from "@playwright/test";

import { plugPad, setAxis, setButton, tap } from "./support/gamepad";
import {
  cardName,
  escapeRegExp,
  expect,
  expectFocus,
  focusedControl,
  focusRoute,
  test,
  until,
} from "./support/harakiri";
import type { FocusedControl } from "./support/harakiri";
import { spokenTitle } from "./support/jellyfin";
import type { ShownItem } from "./support/jellyfin";
import {
  expectResumeShown,
  heroPlay,
  leadContinueWatching,
  main,
  filmSegment,
  openLibrary,
  toFilmBar,
} from "./support/library";

/** The film on tonight's screening, read off its focused Play or Resume. */
const heroTitle = (focus: FocusedControl): string => {
  const title = heroPlay.exec(focus.name)?.[2];

  if (title === undefined) {
    throw new Error(`Focus is not on the hero's Play: ${focus.name}`);
  }

  return title;
};

/** Presses a key and waits until focus rests on a visible, labelled control (named `name` when given). */
const press = async (page: Page, key: string, name?: string | RegExp): Promise<FocusedControl> => {
  await page.keyboard.press(key);

  return await expectFocus(page, name);
};

/** Moves down a row at a time, checking focus after each move, until it rests in `section`. */
const downTo = async (
  page: Page,
  section: string,
  move: () => Promise<void>
): Promise<FocusedControl> => {
  /* oxlint-disable eslint/no-await-in-loop -- one move at a time: each is judged by where focus landed */
  for (let i = 0; i < 6; i += 1) {
    const focus = await expectFocus(page);

    if (focus.section === section) {
      return focus;
    }

    await move();
  }
  /* oxlint-enable eslint/no-await-in-loop */

  throw new Error(`Six moves down never reached ${section}`);
};

test.beforeEach(({ signIn }) => {
  signIn();
});

test("the arrow keys walk the hero, the rows and the title pages, and focus is never lost", async ({
  launch,
  jellyfin,
  preserveUserData,
}) => {
  const { shown } = await leadContinueWatching(jellyfin, preserveUserData);
  const latest = await jellyfin.latest();
  const { 3: picked } = latest;

  if (picked === undefined) {
    throw new Error("The dev library has fewer than 4 recent titles");
  }

  const { page } = await launch();

  const hero = heroTitle(await openLibrary(page));
  await press(page, "ArrowRight", `Details for ${hero}`);
  await press(page, "ArrowLeft", heroPlay);

  // Down from Play lands on the film on stage in the hero bar, then on Continue Watching: the seeded
  // item, with the time left the server's resume point gives.
  const onBar = await toFilmBar(page);
  expect(onBar.name).toBe(hero);
  const resumed = await press(page, "ArrowDown", cardName(spokenTitle(shown)));
  expect(resumed.section).toBe("Continue Watching");
  await expectResumeShown(
    page.getByRole("button", { name: cardName(spokenTitle(shown)) }).first(),
    shown
  );

  // Down through every row in between, to Recently Added, which opens on the newest title.
  const recent = await downTo(page, "Recently Added", async () => {
    await press(page, "ArrowDown");
  });

  expect(recent.name).toMatch(cardName(spokenTitle(latest[0] ?? picked)));

  /* oxlint-disable eslint/no-await-in-loop -- Right is pressed one card at a time */
  for (const i of [1, 2, 3]) {
    const card = await press(page, "ArrowRight", cardName(spokenTitle(latest[i] ?? picked)));
    expect(card.section).toBe("Recently Added");
  }
  /* oxlint-enable eslint/no-await-in-loop */

  // Its title page, then Back to the same card.
  await page.keyboard.press("Enter");
  await expect(main(page, picked.Name)).toBeVisible();
  const title = await expectFocus(page, /^(?:Play|Resume) \S/u, 10_000);
  expect(title.route).toBe(`/title/${picked.Id}`);
  await press(page, "Escape", cardName(spokenTitle(picked)));
  expect(await focusRoute(page)).toBe("/library");

  // Back from the rows returns to tonight's screening, then Details opens the film.
  expect(heroTitle(await press(page, "Escape", heroPlay))).toBe(hero);
  await press(page, "ArrowRight", `Details for ${hero}`);
  await page.keyboard.press("Enter");
  await expect(main(page, hero)).toBeVisible();
  await expectFocus(page, new RegExp(`^(?:Play|Resume) ${escapeRegExp(hero)}$`, "u"));
  await page.keyboard.press("Escape");
  expect(heroTitle(await openLibrary(page))).toBe(hero);
});

test("the gamepad walks the same way: d-pad, stick, A, B, and a held d-pad repeats", async ({
  launch,
  jellyfin,
  preserveUserData,
}) => {
  const { shown } = await leadContinueWatching(jellyfin, preserveUserData);
  const latest = await jellyfin.latest();
  const { page } = await launch();
  const hero = heroTitle(await openLibrary(page));
  await plugPad(page);

  await toFilmBar(page, async () => {
    await tap(page, "down");
  });
  await tap(page, "down");
  await expectFocus(page, cardName(spokenTitle(shown)));
  await tap(page, "a");
  await expect(main(page, shown.Name)).toBeVisible();
  expect(await focusRoute(page, `Resume ${shown.Name}`, 10_000)).toBe(`/title/${shown.Id}`);
  await tap(page, "b");
  expect(await focusRoute(page, cardName(spokenTitle(shown)))).toBe("/library");
  await tap(page, "b");
  expect(heroTitle(await expectFocus(page, heroPlay))).toBe(hero);

  // The left stick past its threshold is a direction too.
  await setAxis(page, 0, 0.9);
  await setAxis(page, 0, 0);
  await expectFocus(page, `Details for ${hero}`);
  await tap(page, "left");
  await expectFocus(page, heroPlay);

  await downTo(page, "Recently Added", async () => {
    await tap(page, "down");
  });

  const nth = (i: number): ShownItem => {
    const item = latest[i];

    if (item === undefined) {
      throw new Error(`Recently Added has no title ${i}`);
    }

    return item;
  };

  await expectFocus(page, cardName(spokenTitle(nth(0))));
  // Held for a second: one press, then a repeat every 120 ms after 400 ms.
  await setButton(page, "right", true);
  await page.waitForTimeout(1000);
  await setButton(page, "right", false);
  const held = await expectFocus(page);
  const index = latest.findIndex((item) => cardName(spokenTitle(item)).test(held.name));
  expect(index).toBeGreaterThanOrEqual(3);
  expect(held.section).toBe("Recently Added");
  const reached = nth(index);

  await tap(page, "a");
  await expect(main(page, reached.Name)).toBeVisible();
  await expectFocus(page, /^(?:Play|Resume) \S/u, 10_000);
  await tap(page, "b");
  expect(await focusRoute(page, cardName(spokenTitle(reached)))).toBe("/library");
});

test("Up from the first row returns to the film on stage in the hero bar, then to Play", async ({
  launch,
  jellyfin,
  preserveUserData,
}) => {
  const { shown } = await leadContinueWatching(jellyfin, preserveUserData);
  const { page } = await launch();
  const hero = heroTitle(await openLibrary(page));
  await toFilmBar(page);
  await press(page, "ArrowDown", cardName(spokenTitle(shown)));
  // Once the row has lit (180 ms) the hero actions fade out, yet stay focusable.
  await page.waitForTimeout(400);
  const bar = await press(page, "ArrowUp", hero);
  expect(bar.section).toBe("Tonight's screening");
  expect(heroTitle(await press(page, "ArrowUp", heroPlay))).toBe(hero);
});

test("Left and Right along the hero bar put each featured film on stage, and Play plays it", async ({
  launch,
}) => {
  const { page } = await launch();
  const hero = heroTitle(await openLibrary(page));
  await toFilmBar(page);

  const second = await press(page, "ArrowRight", filmSegment);
  expect(second.name).not.toBe(hero);
  await expect(
    page.getByRole("button", {
      name: new RegExp(`^(?:Play|Resume) ${escapeRegExp(second.name)}$`, "u"),
    })
  ).toHaveCount(1);
  const third = await press(page, "ArrowRight", filmSegment);
  expect(third.name).not.toBe(second.name);
  const back = await press(page, "ArrowLeft", filmSegment);
  expect(back.name).toBe(second.name);

  // Up returns to Play, now for the chosen film, and a press right away plays it.
  expect(heroTitle(await press(page, "ArrowUp", heroPlay))).toBe(second.name);
  await page.keyboard.press("Enter");
  await expect(main(page, `Screening ${second.name}`)).toBeVisible();
  // Cancel during the House station, before any mpv starts.
  await page.keyboard.press("Escape");
  await openLibrary(page);
});

test("Back from a row answers even when the row was entered a moment ago", async ({
  launch,
  jellyfin,
  preserveUserData,
}) => {
  const { shown } = await leadContinueWatching(jellyfin, preserveUserData);
  const { page } = await launch();
  const hero = heroTitle(await openLibrary(page));
  await plugPad(page);
  await toFilmBar(page, async () => {
    await tap(page, "down");
  });
  await tap(page, "down");
  await expectFocus(page, cardName(spokenTitle(shown)));
  await tap(page, "a");
  await expectFocus(page, `Resume ${shown.Name}`, 10_000);
  await tap(page, "b");
  await expectFocus(page, cardName(spokenTitle(shown)));
  await tap(page, "b");
  expect(heroTitle(await expectFocus(page, heroPlay))).toBe(hero);
});

test("holding Down keeps the focused card on screen at every step", async ({ launch }) => {
  const { page } = await launch();
  await openLibrary(page);
  await plugPad(page);
  await setButton(page, "down", true);
  const seen: (FocusedControl | null)[] = [];
  const deadline = Date.now() + 1200;

  /* oxlint-disable eslint/no-await-in-loop -- sampling focus over time is sequential by definition */
  while (Date.now() < deadline) {
    seen.push(await focusedControl(page));
  }
  /* oxlint-enable eslint/no-await-in-loop */

  await setButton(page, "down", false);

  // The rows wait below the screen while the stage holds, so the first row glides in under its
  // focused card: that card may start below the edge, until it first arrives. From then on, focus
  // never leaves the screen. Focus lost to nothing counts as off screen too.
  const stage = "Tonight's screening";
  const firstRow = seen.find((f) => f !== null && f.section !== stage)?.section;
  const off: (FocusedControl | null)[] = [];
  let arrived = false;

  for (const f of seen) {
    if (f?.section === stage) {
      continue;
    }

    if (f?.inViewport === true) {
      arrived = true;
    } else if (arrived || f === null || f.section !== firstRow) {
      off.push(f);
    }
  }

  expect(off).toEqual([]);
  // The hold travelled: focus went down through more than one row.
  expect(new Set(seen.map((f) => f?.section)).size).toBeGreaterThan(2);
});

test("a key held down on a card opens its title page once and plays nothing", async ({
  launch,
  jellyfin,
  preserveUserData,
}) => {
  const { shown } = await leadContinueWatching(jellyfin, preserveUserData);
  const { page } = await launch();
  await openLibrary(page);
  await toFilmBar(page);
  await press(page, "ArrowDown", cardName(spokenTitle(shown)));
  await page.keyboard.down("Enter");
  await expectFocus(page, `Resume ${shown.Name}`, 10_000);
  // A second keydown while held is an auto-repeat (`event.repeat`), as a remote sends on a long press.
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await page.waitForTimeout(500);
  expect(await focusRoute(page, `Resume ${shown.Name}`)).toBe(`/title/${shown.Id}`);
});

/** Fake timers that keep flowing, installed before the renderer's first script by a reload. */
const withClock = async (page: Page): Promise<string> => {
  await page.clock.install();
  await page.reload();

  return heroTitle(await openLibrary(page));
};

/** Stops the page's clock, so from here on only `runFor` moves time, as far as it is told. */
const pauseClock = async (page: Page): Promise<void> => {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 100);
};

test.describe("the hero cycle", () => {
  test("8 s after a film takes the stage the next one does, and a press in its first 800 ms is ignored", async ({
    launch,
  }) => {
    const { page } = await launch();
    await withClock(page);

    // With the clock stopped, choosing a film on the bar starts its hold at a known instant, and
    // only runFor moves time on, however long the real steps below take.
    await pauseClock(page);
    await toFilmBar(page);
    const { name: chosen } = await press(page, "ArrowRight", filmSegment);
    // Moving between the actions leaves the hold running.
    expect(heroTitle(await press(page, "ArrowUp", heroPlay))).toBe(chosen);
    await press(page, "ArrowRight", `Details for ${chosen}`);
    await press(page, "ArrowLeft", heroPlay);
    await page.clock.runFor(7000);
    expect(heroTitle(await expectFocus(page, heroPlay))).toBe(chosen);
    // The film changes at 8 s; the clock stops 500 ms later, inside the 800 ms settle.
    await page.clock.runFor(1500);

    const advanced = await until(
      "the hero advances 8 s after the film was chosen",
      async () => await expectFocus(page, heroPlay),
      (focused) => heroTitle(focused) !== chosen,
      3000
    );

    expect(advanced.route).toBe("/library");
    const next = heroTitle(advanced);

    // A press this soon was aimed at the film that just left.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    expect(await focusRoute(page, heroPlay)).toBe("/library");
    expect(heroTitle(await expectFocus(page, heroPlay))).toBe(next);

    await page.clock.runFor(1000);
    await page.keyboard.press("Enter");
    await expect(main(page, `Screening ${next}`)).toBeVisible();
    // Cancel during the House station, before any mpv starts.
    await page.keyboard.press("Escape");
    await openLibrary(page);
  });

  test("on the hero bar, focus moves along with the film that takes the stage", async ({
    launch,
  }) => {
    const { page } = await launch();
    const first = await withClock(page);
    const onBar = await toFilmBar(page);
    expect(onBar.name).toBe(first);
    await page.clock.fastForward(9000);
    await until(
      "focus follows the next film along the bar",
      async () => await expectFocus(page, filmSegment),
      (focused) => focused.name !== first,
      3000
    );
  });

  test("reduced motion never advances on its own", async ({ launch }) => {
    const { page } = await launch();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const first = await withClock(page);

    await page.clock.fastForward(60_000);
    await page.waitForTimeout(300);
    expect(heroTitle(await expectFocus(page, heroPlay))).toBe(first);
  });

  test("Play answers a press right after moving back onto it", async ({ launch }) => {
    const { page } = await launch();
    const first = await withClock(page);
    // Stopped, so the 8 s hold cannot change the film under the press.
    await pauseClock(page);
    await press(page, "ArrowRight", `Details for ${first}`);
    await press(page, "ArrowLeft", heroPlay);
    await page.keyboard.press("Enter");
    await expect(main(page, `Screening ${first}`)).toBeVisible();
    await page.keyboard.press("Escape");
    await openLibrary(page);
  });

  test("cancelling a screening started from the hero comes back to the same film", async ({
    launch,
  }) => {
    const { page } = await launch();
    const first = await withClock(page);
    await pauseClock(page);
    await toFilmBar(page);
    const { name: second } = await press(page, "ArrowRight", filmSegment);
    expect(second).not.toBe(first);
    expect(heroTitle(await press(page, "ArrowUp", heroPlay))).toBe(second);
    await page.keyboard.press("Enter");
    await expect(main(page, `Screening ${second}`)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    expect(heroTitle(await openLibrary(page))).toBe(second);
  });
});
