import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { place, remeasure, startSpatial, stopSpatial } from "../test/spatial";
import { QuietAction } from "../ui/actions";
import { focusFirst } from "../ui/focus";
import { useInputHub } from "./hub";

const pressed = { play: 0, programme: 0 };

function Screen() {
  useInputHub();

  return (
    <div>
      <QuietAction focusKey="play" label="Play" onPress={() => (pressed.play += 1)} />
      <QuietAction
        focusKey="programme"
        label="Programme"
        onPress={() => (pressed.programme += 1)}
      />
    </div>
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(async () => {
  pressed.play = 0;
  pressed.programme = 0;
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] });
  startSpatial();
  render(<Screen />);
  place(screen.getByRole("button", { name: "Play" }), { x: 0, y: 0, width: 200, height: 70 });
  place(screen.getByRole("button", { name: "Programme" }), {
    x: 300,
    y: 0,
    width: 200,
    height: 70,
  });
  await remeasure();
  await act(async () => {
    focusFirst("play");
  });
});

afterEach(() => {
  cleanup();
  stopSpatial();
  vi.restoreAllMocks();
});

test("Select presses what norigin has focused, even when the DOM focus went elsewhere", async () => {
  screen.getByRole("button", { name: "Programme" }).focus();
  fireEvent.keyDown(window, { key: "Enter" });
  await settle();
  expect(pressed).toEqual({ play: 1, programme: 0 });
});

test("a held Enter selects once: its auto-repeats are swallowed, not passed to the button", async () => {
  fireEvent.keyDown(window, { key: "Enter" });
  await settle();
  const repeat = new KeyboardEvent("keydown", { key: "Enter", repeat: true, cancelable: true });
  window.dispatchEvent(repeat);
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", repeat: true, cancelable: true })
  );
  await settle();
  expect(pressed).toEqual({ play: 1, programme: 0 });
  expect(repeat.defaultPrevented).toBe(true);
});

test("a held arrow keeps moving, as the gamepad's repeat does", async () => {
  fireEvent.keyDown(window, { key: "ArrowRight", repeat: true });
  await settle();
  fireEvent.keyDown(window, { key: "Enter" });
  await settle();
  expect(pressed).toEqual({ play: 0, programme: 1 });
});
