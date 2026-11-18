import type { Page } from "@playwright/test";

import { plugPad, setAxis, setButton, tap } from "./support/gamepad";
import {
  cardName,
  escapeRegExp,
  expect,
  expectFocus,
  type FocusedControl,
  focusedControl,
  test,
  until,
} from "./support/harakiri";
import { minutesLeft, type ShownItem, spokenTitle } from "./support/jellyfin";
import { heroPlay, leadContinueWatching, main, openLibrary } from "./support/library";

/** The film on tonight's screening, read off its focused Play or Resume. */
function heroTitle(focus: FocusedControl): string {
  const title = heroPlay.exec(focus.name)?.[2];
  if (title === undefined) throw new Error(`Focus is not on the hero's Play: ${focus.name}`);
  return title;
}

/** Presses a key and waits until focus rests on a visible, labelled control (named `name` when given). */
async function press(page: Page, key: string, name?: string | RegExp): Promise<FocusedControl> {
  await page.keyboard.press(key);
  return expectFocus(page, name);
}

/** Moves down a row at a time, checking focus after each move, until it rests in `section`. */
async function downTo(
  page: Page,
  section: string,
  move: () => Promise<unknown>
): Promise<FocusedControl> {
  for (let i = 0; i < 6; i += 1) {
    const focus = await expectFocus(page);
    if (focus.section === section) return focus;
    await move();
  }
  throw new Error(`Six moves down never reached ${section}`);
}

test.beforeEach(({ signIn }) => signIn());

test("the arrow keys walk the hero, the rows and the title pages, and focus is never lost", async ({
  launch,
  jellyfin,
  preserveUserData,
}) => {
  const { shown } = await leadContinueWatching(jellyfin, preserveUserData);
  const latest = await jellyfin.latest();
  const picked = latest[3];
  if (picked === undefined) throw new Error("The dev library has fewer than 4 recent titles");
  const { page } = await launch();

  const hero = heroTitle(await openLibrary(page));
  await press(page, "ArrowRight", `Programme notes for ${hero}`);
  const next = await press(page, "ArrowRight", /^Next screening: \S/);
  expect(next.name).not.toBe(`Next screening: ${hero}`);
  await press(page, "ArrowLeft", `Programme notes for ${hero}`);
  await press(page, "ArrowLeft", heroPlay);

  // Continue Watching: the seeded item, with the time left the server's resume point gives.
  const resumed = await press(page, "ArrowDown", cardName(spokenTitle(shown)));
  expect(resumed.section).toBe("Continue Watching");
  const left = minutesLeft(shown);
  expect(left).not.toBeNull();
  await expect(
    page.getByRole("button", { name: cardName(spokenTitle(shown)) }).first()
  ).toContainText(`${left} min left`);

  // Down through every row in between, to Recently Added, which opens on the newest title.
  const recent = await downTo(page, "Recently Added", () => press(page, "ArrowDown"));
  expect(recent.name).toMatch(cardName(spokenTitle(latest[0] ?? picked)));
  for (const i of [1, 2, 3]) {
    const card = await press(page, "ArrowRight", cardName(spokenTitle(latest[i] ?? picked)));
    expect(card.section).toBe("Recently Added");
  }

  // Its title page, then Back to the same card.
  await page.keyboard.press("Enter");
  await expect(main(page, picked.Name)).toBeVisible();
  const title = await expectFocus(page, /^(Play|Resume) \S/, 10_000);
  expect(title.route).toBe(`/title/${picked.Id}`);
  await press(page, "Escape", cardName(spokenTitle(picked)));
  expect((await expectFocus(page)).route).toBe("/library");

  // Back from the rows returns to tonight's screening, then its programme notes open the film.
  expect(heroTitle(await press(page, "Escape", heroPlay))).toBe(hero);
  await press(page, "ArrowRight", `Programme notes for ${hero}`);
  await page.keyboard.press("Enter");
  await expect(main(page, hero)).toBeVisible();
  await expectFocus(page, new RegExp(`^(Play|Resume) ${escapeRegExp(hero)}$`));
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

  await tap(page, "down");
  await expectFocus(page, cardName(spokenTitle(shown)));
  await tap(page, "a");
  await expect(main(page, shown.Name)).toBeVisible();
  expect((await expectFocus(page, `Resume ${shown.Name}`, 10_000)).route).toBe(
    `/title/${shown.Id}`
  );
  await tap(page, "b");
  expect((await expectFocus(page, cardName(spokenTitle(shown)))).route).toBe("/library");
  await tap(page, "b");
  expect(heroTitle(await expectFocus(page, heroPlay))).toBe(hero);

  // The left stick past its threshold is a direction too.
  await setAxis(page, 0, 0.9);
  await setAxis(page, 0, 0);
  await expectFocus(page, `Programme notes for ${hero}`);
  await tap(page, "left");
  await expectFocus(page, heroPlay);

  await downTo(page, "Recently Added", () => tap(page, "down"));
  const nth = (i: number): ShownItem => {
    const item = latest[i];
    if (item === undefined) throw new Error(`Recently Added has no title ${i}`);
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
  await expectFocus(page, /^(Play|Resume) \S/, 10_000);
  await tap(page, "b");
  expect((await expectFocus(page, cardName(spokenTitle(reached)))).route).toBe("/library");
});

test("Up from the first row returns to tonight's screening", async ({
  launch,
  jellyfin,
  preserveUserData,
}) => {
  const { shown } = await leadContinueWatching(jellyfin, preserveUserData);
  const { page } = await launch();
  const hero = heroTitle(await openLibrary(page));
  await press(page, "ArrowDown", cardName(spokenTitle(shown)));
  // Once the row has lit (180 ms) the hero actions fade out, yet stay focusable.
  await page.waitForTimeout(400);
  expect(heroTitle(await press(page, "ArrowUp", heroPlay))).toBe(hero);
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
  while (Date.now() < deadline) seen.push(await focusedControl(page));
  await setButton(page, "down", false);
  // Focus lost to nothing counts as off screen too.
  const off = seen.filter(
    (f) => f === null || (f.section !== "Tonight's screening" && !f.inViewport)
  );
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
  await press(page, "ArrowDown", cardName(spokenTitle(shown)));
  await page.keyboard.down("Enter");
  await expectFocus(page, `Resume ${shown.Name}`, 10_000);
  // A second keydown while held is an auto-repeat (`event.repeat`), as a remote sends on a long press.
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await page.waitForTimeout(500);
  expect((await expectFocus(page, `Resume ${shown.Name}`)).route).toBe(`/title/${shown.Id}`);
});

/** Fake timers that keep flowing, installed before the renderer's first script by a reload. */
async function withClock(page: Page): Promise<string> {
  await page.clock.install();
  await page.reload();
  return heroTitle(await openLibrary(page));
}

/** Stops the page's clock, so from here on only `runFor` moves time, as far as it is told. */
async function pauseClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 100);
}

const nextTitle = async (page: Page) =>
  (
    (await page.getByRole("button", { name: /^Next screening: / }).getAttribute("aria-label")) ?? ""
  ).replace(/^Next screening: /, "");

test.describe("the hero cycle", () => {
  test("after 20 quiet seconds the film Next promised takes the screen, and a press in its first 800 ms is ignored", async ({
    launch,
  }) => {
    const { page } = await launch();
    const first = await withClock(page);
    const second = await nextTitle(page);
    expect(second).not.toBe(first);
    await expect(page.getByRole("button", { name: `Next screening: ${second}` })).toContainText(
      "Next in 20 quiet seconds"
    );

    // With the clock stopped, a press starts the hold at a known instant and only runFor moves
    // time on, however long the real steps below take.
    await pauseClock(page);
    await press(page, "ArrowRight", `Programme notes for ${first}`);
    await press(page, "ArrowLeft", heroPlay);
    await page.clock.runFor(19_000);
    expect(heroTitle(await expectFocus(page, heroPlay))).toBe(first);
    // The film changes at 20 s; the clock stops 500 ms later, inside the 800 ms settle.
    await page.clock.runFor(1_500);
    const advanced = await expectFocus(page, new RegExp(`^(Play|Resume) ${escapeRegExp(second)}$`));
    expect(advanced.route).toBe("/library");
    const third = await nextTitle(page);
    expect(third).not.toBe(second);

    // A press this soon was aimed at the film that just left.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    expect((await expectFocus(page, heroPlay)).route).toBe("/library");
    expect(heroTitle(await expectFocus(page, heroPlay))).toBe(second);

    await page.clock.runFor(1_000);
    await page.keyboard.press("Enter");
    await expect(main(page, `Screening ${second}`)).toBeVisible();
    // Cancel during the House station, before any mpv starts.
    await page.keyboard.press("Escape");
    await openLibrary(page);
  });

  test("any press restarts the 20 s hold", async ({ launch }) => {
    const { page } = await launch();
    const first = await withClock(page);
    const second = await nextTitle(page);

    await page.clock.fastForward(15_000);
    await press(page, "ArrowRight", `Programme notes for ${first}`);
    await press(page, "ArrowLeft", heroPlay);
    await page.clock.fastForward(15_000);
    expect(heroTitle(await expectFocus(page, heroPlay))).toBe(first);
    await page.clock.fastForward(6_000);
    await until(
      "the hero advances 20 s after the last press",
      async () => heroTitle(await expectFocus(page, heroPlay)),
      (title) => title === second,
      3000
    );
  });

  test("reduced motion never advances on its own; Next still moves on", async ({ launch }) => {
    const { page } = await launch();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const first = await withClock(page);
    const second = await nextTitle(page);
    const nextButton = page.getByRole("button", { name: `Next screening: ${second}` });
    await expect(nextButton).toContainText("Next screening");
    await expect(nextButton).not.toContainText("quiet seconds");

    await page.clock.fastForward(60_000);
    await page.waitForTimeout(300);
    expect(heroTitle(await expectFocus(page, heroPlay))).toBe(first);

    await press(page, "ArrowRight", `Programme notes for ${first}`);
    await press(page, "ArrowRight", `Next screening: ${second}`);
    await page.keyboard.press("Enter");
    await expectFocus(page, /^Next screening: /);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    expect(heroTitle(await expectFocus(page, heroPlay))).toBe(second);
  });

  test("Play answers a press right after moving back onto it", async ({ launch }) => {
    const { page } = await launch();
    const first = await withClock(page);
    await page.clock.fastForward(2_000);
    await press(page, "ArrowRight", `Programme notes for ${first}`);
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
    await page.clock.fastForward(21_000);
    const second = heroTitle(await expectFocus(page, heroPlay));
    expect(second).not.toBe(first);
    await page.clock.fastForward(1_000);
    await page.keyboard.press("Enter");
    await expect(main(page, `Screening ${second}`)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    expect(heroTitle(await openLibrary(page))).toBe(second);
  });
});
