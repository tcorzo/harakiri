import type { Locator, Page } from "@playwright/test";

import { cardName, escapeRegExp, expect, expectFocus } from "./harakiri";
import type { FocusedControl } from "./harakiri";
import { ITEMS, minutesLeft, spokenTitle } from "./jellyfin";
import type { Jellyfin, PickedItem, ShownItem } from "./jellyfin";

export const heroPlay = /^(?<verb>Play|Resume) (?<title>.+)$/u;

export const main = (page: Page, name: string) => page.getByRole("main", { name, exact: true });

/**
 * Waits for the library, its rows, and focus on tonight's Play, as every launch with a session
 * lands. The rows arrive after the hero (one suspense boundary for all of them), and a Down pressed
 * before they mount has nowhere to go.
 */
export const openLibrary = async (page: Page): Promise<FocusedControl> => {
  await expect(main(page, "Library")).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("region", { name: "Recently Added", exact: true }).getByRole("button").first()
  ).toBeVisible({ timeout: 20_000 });
  const focus = await expectFocus(page, heroPlay, 10_000);
  expect(focus.route).toBe("/library");

  return focus;
};

/**
 * An SDR item of 6 to 20 minutes with a resume point played just now leads Continue Watching, so a
 * test knows the first card without depending on what the owner last watched. Its user data is
 * put back at teardown.
 */
export const leadContinueWatching = async (
  jellyfin: Jellyfin,
  preserveUserData: (id: PickedItem["id"]) => Promise<void>,
  seconds = 120
): Promise<{ item: PickedItem; shown: ShownItem }> => {
  const item = await jellyfin.pickItem(ITEMS.sdrH264Short);
  await preserveUserData(item.id);
  await jellyfin.seedResume(item.id, seconds);
  const [leading] = await jellyfin.resumeIds();
  expect(leading).toBe(item.id);

  return { item, shown: await jellyfin.item(item.id) };
};

/** A segment of the hero bar: named by its film, unlike the actions above it. */
export const filmSegment = /^(?!Play |Resume |Details for ).+$/u;

/**
 * From the hero's actions, one `move` down lands on the film on stage in the hero bar, still in
 * tonight's screening; the rows are the move after it.
 */
export const toFilmBar = async (
  page: Page,
  move: () => Promise<void> = async () => {
    await page.keyboard.press("ArrowDown");
  }
): Promise<FocusedControl> => {
  await move();
  const focus = await expectFocus(page, filmSegment);
  expect(focus.section).toBe("Tonight's screening");

  return focus;
};

/** From the library: Down through the hero bar to the first Continue Watching card, then Enter, landing on Resume. */
export const openFirstResumed = async (page: Page, shown: ShownItem): Promise<void> => {
  await openLibrary(page);
  await toFilmBar(page);
  await page.keyboard.press("ArrowDown");
  await expectFocus(page, cardName(spokenTitle(shown)));
  await page.keyboard.press("Enter");
  await expect(main(page, shown.Name)).toBeVisible();
  const focus = await expectFocus(page, `Resume ${shown.Name}`, 10_000);
  expect(focus.route).toBe(`/title/${shown.Id}`);
};

/**
 * A card shows how far its item was watched: the rule along the picture's foot is as long as the
 * server's resume point says, and only an episode card prints the time left; a film card prints
 * nothing at all.
 */
export const expectResumeShown = async (card: Locator, shown: ShownItem): Promise<void> => {
  const left = minutesLeft(shown);
  expect(left).not.toBeNull();

  const played = (shown.UserData?.PlayedPercentage ?? 0) / 100;
  const rule = card.locator('[style*="scaleX"]');
  await expect(rule).toHaveCount(1);

  const scale = await rule.evaluate((node) =>
    Number(/scaleX\((?<x>[\d.]+)\)/u.exec(node.getAttribute("style") ?? "")?.groups?.x)
  );

  expect(scale).toBeCloseTo(played, 3);

  await expect(card).toHaveText(
    shown.Type === "Episode" ? new RegExp(`${escapeRegExp(String(left))} min left`, "u") : /^$/u
  );
};
