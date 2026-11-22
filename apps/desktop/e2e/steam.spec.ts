import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { fakeSteamRoot } from "../src/main/host/fixtures/steam-root";
import { encodeShortcuts } from "../src/main/host/steam/fixtures/vdf";
import { expect, expectFocus, test, until } from "./support/harakiri";

const target = "/opt/harakiri/harakiri-x86_64.AppImage";
const steamUser = "12345678";

// Above 2^31: Steam writes it as a negative int32, and the grid names use the unsigned value.
const appId = 3_141_592_653;
const playOrResume = /^(?:Play|Resume) \S/u;

// Every spec runs on an empty HOME, so Steam is there only when a test builds it with fakeSteamRoot.
test.use({ extraEnv: { HARAKIRI_E2E_LAUNCH_TARGET: target } });

const card = (page: Page) => page.getByRole("region", { name: "Play harakiri from Steam" });

const settings = (page: Page) => page.getByRole("main", { name: "Settings", exact: true });

/** From the library's Play, up to the Settings link and into Settings. */
const openSettings = async (page: Page): Promise<void> => {
  await page.keyboard.press("ArrowUp");
  await expectFocus(page, "Settings");
  await page.keyboard.press("Enter");
  await expect(settings(page)).toBeVisible();
};

test("with Steam present, Add writes the launcher, asks Steam, and puts the art in grid/", async ({
  launch,
  signIn,
  homeDir,
  userDataDir,
}) => {
  const steam = fakeSteamRoot(homeDir, { [steamUser]: null });
  const config = path.join(steam, "userdata", steamUser, "config");
  const dir = path.join(userDataDir, "steam");
  const script = path.join(dir, "harakiri.sh");
  const desktop = path.join(dir, "harakiri.desktop");
  const opened = path.join(userDataDir, "e2e-opened-urls.txt");
  const sentinel = path.join(userDataDir, "addnonsteamgamefile");
  signIn();
  const { page } = await launch();

  await expect(card(page)).toBeVisible({ timeout: 20_000 });
  await expectFocus(page, "Add to Steam", 10_000);
  await page.keyboard.press("Enter");

  await until(
    "the app asks Steam to add its launcher",
    () => (existsSync(opened) ? readFileSync(opened, "utf-8") : ""),
    (urls) => urls !== ""
  );
  expect(readFileSync(opened, "utf-8")).toBe(
    `steam://addnonsteamgame/${encodeURIComponent(desktop)}\n`
  );
  await expectFocus(page, "Adding to Steam…");
  // Steam only adds the entry while the sentinel is there.
  expect(existsSync(sentinel)).toBe(true);

  // oxlint-disable-next-line no-bitwise -- the permission bits of the mode
  expect(statSync(script).mode & 0o777).toBe(0o755);
  expect(readFileSync(script, "utf-8")).toContain(`exec '${target}' "$@"\n`);
  const entry = readFileSync(desktop, "utf-8");
  expect(entry).toContain(`Exec=${script}\n`);
  expect(entry).toContain("NoDisplay=true\n");

  // What Steam writes once it has added the .desktop entry: its own quoted Exe.
  writeFileSync(
    path.join(config, "shortcuts.vdf"),
    encodeShortcuts([{ appId, appName: "harakiri", exe: `"${script}"` }])
  );

  await expect(card(page)).toBeHidden({ timeout: 10_000 });
  await expectFocus(page, playOrResume);
  expect(readdirSync(path.join(config, "grid")).toSorted()).toEqual([
    "3141592653.png",
    "3141592653_hero.png",
    "3141592653_logo.png",
    "3141592653p.png",
  ]);
  expect(existsSync(sentinel)).toBe(false);

  await openSettings(page);
  await expect(settings(page).locator("dl")).toContainText("Steamharakiri is in your library");
  await expect(page.getByRole("button", { name: "Add to Steam", exact: true })).toHaveCount(0);
});

test("the card holds the d-pad, and focus comes back to it from Settings", async ({
  launch,
  signIn,
  homeDir,
}) => {
  fakeSteamRoot(homeDir, { [steamUser]: null });
  signIn();
  const { page } = await launch();

  await expect(card(page)).toBeVisible({ timeout: 20_000 });
  // The card takes focus before Play, the first time the library mounts.
  await expectFocus(page, "Add to Steam", 10_000);

  // Left and right pick an action; up and down stay on the card until it is answered.
  for (const [key, focused] of [
    ["ArrowRight", "Not now"],
    ["ArrowUp", "Not now"],
    ["ArrowDown", "Not now"],
    ["ArrowLeft", "Add to Steam"],
    ["ArrowUp", "Add to Steam"],
    ["ArrowDown", "Add to Steam"],
    ["ArrowRight", "Not now"],
  ] as const) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each press must land before the next
    await page.keyboard.press(key);
    // oxlint-disable-next-line eslint/no-await-in-loop -- each press must land before the next
    await expectFocus(page, focused);
  }

  // Menu reaches Settings while the card holds the d-pad; Settings offers the same action.
  await page.keyboard.press("ContextMenu");
  await expect(settings(page)).toBeVisible();
  await expectFocus(page, "Sign out");
  await expect(page.getByRole("button", { name: "Add to Steam", exact: true })).toBeVisible();

  // Back remounts the library on the cached status: the card draws at once and takes focus again,
  // on its first action, not on Play or on the Not now the owner left.
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeVisible();
  await expectFocus(page, "Add to Steam");

  // And again, so the second remount is not the first one's leftover focus.
  await page.keyboard.press("ContextMenu");
  await expectFocus(page, "Sign out");
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeVisible();
  await expectFocus(page, "Add to Steam");
});

test("Not now hides the card across a restart, and Settings still offers Add to Steam", async ({
  launch,
  signIn,
  homeDir,
}) => {
  fakeSteamRoot(homeDir, { [steamUser]: null });
  signIn();
  const first = await launch();

  await expect(card(first.page)).toBeVisible({ timeout: 20_000 });
  await expectFocus(first.page, "Add to Steam", 10_000);
  await first.page.keyboard.press("Escape");
  await expect(card(first.page)).toBeHidden();
  await expectFocus(first.page, playOrResume);
  await first.app.close();

  const { page } = await launch();
  await expectFocus(page, playOrResume, 20_000);
  // Steam is still there to add to: only the card was put off.
  expect(await page.evaluate(async () => await window.harakiri.launcher.status())).toEqual({
    state: "offered",
    name: "Steam",
  });
  await expect(card(page)).toHaveCount(0);

  await openSettings(page);
  await expect(page.getByRole("button", { name: "Add to Steam", exact: true })).toBeVisible();
});

test("without Steam there is no card and no Settings action", async ({ launch, signIn }) => {
  signIn();
  const { page } = await launch();

  await expectFocus(page, playOrResume, 20_000);
  expect(await page.evaluate(async () => await window.harakiri.launcher.status())).toEqual({
    state: "unavailable",
  });
  await expect(card(page)).toHaveCount(0);

  await openSettings(page);
  await expectFocus(page, "Sign out");
  await expect(page.getByRole("button", { name: "Add to Steam", exact: true })).toHaveCount(0);
  await expect(settings(page)).not.toContainText("harakiri is in your library");
});
