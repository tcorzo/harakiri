import type { Page } from "@playwright/test";
import { cardName, expect, expectFocus, type FocusedControl } from "./harakiri";
import { ITEMS, type Jellyfin, type PickedItem, type ShownItem, spokenTitle } from "./jellyfin";

export const heroPlay = /^(Play|Resume) (.+)$/;

export const main = (page: Page, name: string) => page.getByRole("main", { name, exact: true });

/**
 * Waits for the library, its rows, and focus on tonight's Play, as every launch with a session
 * lands. The rows arrive after the hero (one suspense boundary for all of them), and a Down pressed
 * before they mount has nowhere to go.
 */
export async function openLibrary(page: Page): Promise<FocusedControl> {
  await expect(main(page, "Library")).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("region", { name: "Recently Added", exact: true }).getByRole("button").first(),
  ).toBeVisible({ timeout: 20_000 });
  const focus = await expectFocus(page, heroPlay, 10_000);
  expect(focus.route).toBe("/library");
  return focus;
}

/**
 * An SDR item of 6 to 20 minutes with a resume point played just now leads Continue Watching, so a
 * test knows the first card without depending on what the owner last watched. Its user data is
 * put back at teardown.
 */
export async function leadContinueWatching(
  jellyfin: Jellyfin,
  preserveUserData: (id: PickedItem["id"]) => Promise<void>,
  seconds = 120,
): Promise<{ item: PickedItem; shown: ShownItem }> {
  const item = await jellyfin.pickItem(ITEMS.sdrH264Short);
  await preserveUserData(item.id);
  await jellyfin.seedResume(item.id, seconds);
  expect((await jellyfin.resumeIds())[0]).toBe(item.id);
  return { item, shown: await jellyfin.item(item.id) };
}

/** From the library: Down to the first Continue Watching card, then Enter, landing on Resume. */
export async function openFirstResumed(page: Page, shown: ShownItem): Promise<void> {
  await openLibrary(page);
  await page.keyboard.press("ArrowDown");
  await expectFocus(page, cardName(spokenTitle(shown)));
  await page.keyboard.press("Enter");
  await expect(main(page, shown.Name)).toBeVisible();
  const focus = await expectFocus(page, `Resume ${shown.Name}`, 10_000);
  expect(focus.route).toBe(`/title/${shown.Id}`);
}
