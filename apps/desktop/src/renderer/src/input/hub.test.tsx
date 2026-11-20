import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { place, remeasure, startSpatial, stopSpatial } from "../test/spatial";
import { QuietAction } from "../ui/actions";
import { focusFirst } from "../ui/focus";
import { useInputHub } from "./hub";

const pressed = { play: 0, programme: 0 };

const Screen = () => {
  useInputHub();

  return (
    <div>
      <QuietAction
        focusKey="play"
        label="Play"
        onPress={() => {
          pressed.play += 1;
        }}
      />
      <QuietAction
        focusKey="programme"
        label="Programme"
        onPress={() => {
          pressed.programme += 1;
        }}
      />
    </div>
  );
};

const settle = async (): Promise<void> => {
  await act(async () => {
    // oxlint-disable-next-line promise/avoid-new -- setTimeout has no promise form in the DOM lib
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
};

describe("hub", () => {
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
    act(() => {
      focusFirst("play");
    });
  });

  afterEach(() => {
    cleanup();
    stopSpatial();
    vi.restoreAllMocks();
  });

  it("Select presses what norigin has focused, even when the DOM focus went elsewhere", async () => {
    screen.getByRole("button", { name: "Programme" }).focus();
    fireEvent.keyDown(window, { key: "Enter" });
    await settle();
    expect(pressed).toStrictEqual({ play: 1, programme: 0 });
  });

  it("a held Enter selects once: its auto-repeats are swallowed, not passed to the button", async () => {
    fireEvent.keyDown(window, { key: "Enter" });
    await settle();
    const repeat = new KeyboardEvent("keydown", { key: "Enter", repeat: true, cancelable: true });
    window.dispatchEvent(repeat);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", repeat: true, cancelable: true })
    );
    await settle();
    expect(pressed).toStrictEqual({ play: 1, programme: 0 });
    expect(repeat.defaultPrevented).toBe(true);
  });

  it("a held arrow keeps moving, as the gamepad's repeat does", async () => {
    fireEvent.keyDown(window, { key: "ArrowRight", repeat: true });
    await settle();
    fireEvent.keyDown(window, { key: "Enter" });
    await settle();
    expect(pressed).toStrictEqual({ play: 0, programme: 1 });
  });
});
