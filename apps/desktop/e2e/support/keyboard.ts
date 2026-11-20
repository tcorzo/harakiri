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

const focusedName = async (page: Page): Promise<string | undefined> => {
  const focus = await focusedControl(page);

  return focus?.name;
};

/** The d-pad direction that closes the larger gap to the target, vertical first. */
const directionToward = (dx: number, dy: number, at: Box): Move => {
  if (Math.abs(dy) >= at.h / 2) {
    return dy < 0 ? "up" : "down";
  }

  return dx < 0 ? "left" : "right";
};

const centre = async (page: Page, key: string | null) =>
  await page.evaluate((label) => {
    const board = document.querySelector('fieldset[aria-label="On-screen keyboard"]');

    if (board === null) {
      return null;
    }

    const el =
      label === null
        ? document.activeElement
        : [...board.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label);

    if (!(el instanceof HTMLElement) || !board.contains(el)) {
      return null;
    }

    const r = el.getBoundingClientRect();

    return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height, w: r.width };
  }, key);

/**
 * Presses each named key of the on-screen keyboard by walking focus to it with the d-pad, the way
 * an owner with only a gamepad types. Fails if a move does not move focus or focus leaves the board.
 */
export const typeOnScreen = async (
  page: Page,
  dpad: Dpad,
  keys: readonly string[]
): Promise<void> => {
  /* oxlint-disable eslint/no-await-in-loop -- the d-pad is driven one press at a time: each move depends on where focus landed */
  for (const key of keys) {
    const target = await centre(page, key);

    if (target === null) {
      throw new Error(`The on-screen keyboard has no key "${key}"`);
    }

    for (let steps = 0; ; steps += 1) {
      if (steps > 24) {
        throw new Error(`Could not reach key "${key}" in 24 moves`);
      }

      const at: Box | null = await centre(page, null);

      if (at === null) {
        throw new Error(
          `Focus left the on-screen keyboard: ${JSON.stringify(await focusedControl(page))}`
        );
      }

      const dy = target.y - at.y;
      const dx = target.x - at.x;

      if (Math.abs(dy) < at.h / 2 && Math.abs(dx) < at.w / 2) {
        break;
      }

      const before = await focusedName(page);
      await dpad.move(directionToward(dx, dy, at));
      await until(
        `a d-pad move off "${before}" moves focus`,
        async () => await focusedName(page),
        (name) => name !== before,
        2000,
        20
      );
    }

    await dpad.select();
  }
  /* oxlint-enable eslint/no-await-in-loop */
};

/** Splits text into the keyboard's keys, using its one-press inserts where the text contains them. */
export const keysFor = (text: string, inserts: readonly string[] = []): string[] => {
  const keys: string[] = [];
  let rest = text;

  while (rest.length > 0) {
    const current = rest;
    const insert = inserts.find((i) => current.startsWith(i));
    const next = insert ?? current.charAt(0);
    keys.push(next);
    rest = current.slice(next.length);
  }

  return keys;
};

/** The arrow keys and Enter of a physical keyboard or a TV remote that sends them. */
export const arrowKeys = (page: Page): Dpad => ({
  move: async (direction) => {
    await page.keyboard.press(
      ({ up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" } as const)[
        direction
      ]
    );
  },
  select: async () => {
    await page.keyboard.press("Enter");
  },
});

/** Moves focus up until it rests on the text field labelled `label`, as the d-pad leaves a keyboard. */
export const focusField = async (page: Page, label: string): Promise<void> => {
  /* oxlint-disable eslint/no-await-in-loop -- each press is judged by where focus landed */
  for (let i = 0; i < 4; i += 1) {
    if ((await focusedName(page)) === label) {
      return;
    }

    await page.keyboard.press("ArrowUp");
  }
  /* oxlint-enable eslint/no-await-in-loop */

  if ((await focusedName(page)) !== label) {
    throw new Error(
      `ArrowUp never reached the "${label}" field: ${JSON.stringify(await focusedControl(page))}`
    );
  }
};
