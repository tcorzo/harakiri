import { once } from "node:events";

import type { ElectronApplication, Page } from "@playwright/test";

import { expect, expectFocus, test } from "./support/harakiri";
import { main, openLibrary } from "./support/library";

test.beforeEach(({ signIn }) => {
  signIn();
});

/** Presses Enter on the focused Quit harakiri and waits for the Electron process to exit. */
const pressQuit = async (app: ElectronApplication, page: Page): Promise<void> => {
  const child = app.process();
  const exited = once(child, "exit");

  // The app can exit before Playwright acknowledges the press, which rejects the press itself.
  await Promise.allSettled([page.keyboard.press("Enter")]);
  await exited;

  expect(child.exitCode).toBe(0);
};

test("Quit harakiri at the end of Settings ends the app", async ({ launch }) => {
  const { app, page } = await launch();
  await openLibrary(page);

  await page.keyboard.press("ContextMenu");
  await expect(main(page, "Settings")).toBeVisible();
  await expectFocus(page, "Sign out");

  /* oxlint-disable eslint/no-await-in-loop -- one move at a time: each is judged by where focus landed */
  for (let i = 0; i < 4; i += 1) {
    const focus = await expectFocus(page);

    if (focus.name === "Quit harakiri") {
      break;
    }

    await page.keyboard.press("ArrowDown");
  }
  /* oxlint-enable eslint/no-await-in-loop */

  await expectFocus(page, "Quit harakiri");
  await pressQuit(app, page);
});

test("Back from tonight's screening asks to leave, and Quit harakiri ends the app", async ({
  launch,
}) => {
  const { app, page } = await launch();
  await openLibrary(page);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Leave harakiri?", exact: true })).toBeVisible();
  await expectFocus(page, "Stay");

  await page.keyboard.press("ArrowDown");
  await expectFocus(page, "Quit harakiri");
  await pressQuit(app, page);
});
