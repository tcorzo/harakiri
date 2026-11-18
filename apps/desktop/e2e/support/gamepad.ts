import type { Page } from "@playwright/test";

import type { Dpad } from "./keyboard";

/** W3C "standard" mapping indices, as packages/input reads them. */
export const BUTTON = {
  a: 0,
  b: 1,
  y: 3,
  view: 8,
  start: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

export type Button = keyof typeof BUTTON;

interface FakePad {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  timestamp: number;
  axes: number[];
  buttons: { pressed: boolean; touched: boolean; value: number }[];
}

declare global {
  interface Window {
    harakiriE2ePad?: FakePad;
  }
}

/**
 * Plugs a standard-mapping pad into the renderer. The input hub calls `navigator.getGamepads()` on
 * every animation frame, so replacing it at runtime is all a real pad would change.
 */
export async function plugPad(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pad: FakePad = {
      id: "harakiri e2e pad (STANDARD GAMEPAD)",
      index: 0,
      connected: true,
      mapping: "standard",
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };

    window.harakiriE2ePad = pad;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [pad, null, null, null],
    });
  });
}

/** Sets a button and waits two frames, so the poller has sampled the new state before anything else changes. */
export async function setButton(page: Page, button: Button, pressed: boolean): Promise<void> {
  await page.evaluate(
    async ([index, down]) => {
      const pad = window.harakiriE2ePad;

      if (pad === undefined) throw new Error("plugPad() first");
      pad.buttons[index] = { pressed: down, touched: down, value: down ? 1 : 0 };
      pad.timestamp += 1;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    },
    [BUTTON[button], pressed] as const
  );
}

/** Pushes a stick axis (0 left-right, 1 up-down) to `value` and waits two frames. */
export async function setAxis(page: Page, axis: 0 | 1, value: number): Promise<void> {
  await page.evaluate(
    async ([index, to]) => {
      const pad = window.harakiriE2ePad;

      if (pad === undefined) throw new Error("plugPad() first");
      pad.axes[index] = to;
      pad.timestamp += 1;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    },
    [axis, value] as const
  );
}

/** One press and release. */
export async function tap(page: Page, button: Button): Promise<void> {
  await setButton(page, button, true);
  await setButton(page, button, false);
}

/** The pad's d-pad and A, for helpers written against any d-pad. */
export const padDpad = (page: Page): Dpad => ({
  move: (direction) => tap(page, direction),
  select: () => tap(page, "a"),
});
