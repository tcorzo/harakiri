import type { Page } from "@playwright/test";

import { focusedControl, until } from "./harakiri";

export type Move = "up" | "down" | "left" | "right";

/** A d-pad: four directions and select, from whichever source the test drives (arrow keys or a pad). */
export interface Dpad {
  readonly move: (direction: Move) => Promise<void>;
  readonly select: () => Promise<void>;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly h: number;
  readonly w: number;
}

const centre = (page: Page, key: string | null) =>
  page.evaluate((label) => {
    const board = document.querySelector('fieldset[aria-label="On-screen keyboard"]');
    if (board === null) return null;
    const el =
      label === null
        ? document.activeElement
        : [...board.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label);
    if (!(el instanceof HTMLElement) || !board.contains(el)) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height, w: r.width };
  }, key);

/**
 * Presses each named key of the on-screen keyboard by walking focus to it with the d-pad, the way
 * an owner with only a gamepad types. Fails if a move does not move focus or focus leaves the board.
 */
export async function typeOnScreen(page: Page, dpad: Dpad, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    const target = await centre(page, key);
    if (target === null) throw new Error(`The on-screen keyboard has no key "${key}"`);
    for (let steps = 0; ; steps += 1) {
      if (steps > 24) throw new Error(`Could not reach key "${key}" in 24 moves`);
      const at: Box | null = await centre(page, null);
      if (at === null) {
        throw new Error(
          `Focus left the on-screen keyboard: ${JSON.stringify(await focusedControl(page))}`
        );
      }
      const dy = target.y - at.y;
      const dx = target.x - at.x;
      if (Math.abs(dy) < at.h / 2 && Math.abs(dx) < at.w / 2) break;
      const before = (await focusedControl(page))?.name;
      await dpad.move(
        Math.abs(dy) >= at.h / 2 ? (dy < 0 ? "up" : "down") : dx < 0 ? "left" : "right"
      );
      await until(
        `a d-pad move off "${before}" moves focus`,
        async () => (await focusedControl(page))?.name,
        (name) => name !== before,
        2000,
        20
      );
    }
    await dpad.select();
  }
}

/** Splits text into the keyboard's keys, using its one-press inserts where the text contains them. */
export function keysFor(text: string, inserts: readonly string[] = []): string[] {
  const keys: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    const insert = inserts.find((i) => rest.startsWith(i));
    const next = insert ?? rest.charAt(0);
    keys.push(next);
    rest = rest.slice(next.length);
  }
  return keys;
}

/** The arrow keys and Enter of a physical keyboard or a TV remote that sends them. */
export const arrowKeys = (page: Page): Dpad => ({
  move: (direction) =>
    page.keyboard.press(
      ({ up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" } as const)[
        direction
      ]
    ),
  select: () => page.keyboard.press("Enter"),
});

/** Moves focus up until it rests on the text field labelled `label`, as the d-pad leaves a keyboard. */
export async function focusField(page: Page, label: string): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    if ((await focusedControl(page))?.name === label) return;
    await page.keyboard.press("ArrowUp");
  }
  if ((await focusedControl(page))?.name !== label) {
    throw new Error(
      `ArrowUp never reached the "${label}" field: ${JSON.stringify(await focusedControl(page))}`
    );
  }
}
