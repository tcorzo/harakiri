import { describe, expect, it } from "vitest";

import { idlePad, isEditing, keyToAction, route, seedHeld, stepPad } from "./index";
import type { PadSnapshot, PadState } from "./index";

const timing = { delayMs: 400, intervalMs: 100 };

const pad = (pressed: readonly number[], axes: readonly number[] = [0, 0, 0, 0]): PadSnapshot => ({
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
  axes,
});

/** A frame polls the pad; a `switch` frame is an input mode change, as the hub handles it. */
type Frame = readonly [number, PadSnapshot] | readonly ["switch", number, PadSnapshot];

const run = (frames: readonly Frame[]): string[][] => {
  let state: PadState = idlePad;

  return frames.map((frame) => {
    if (frame[0] === "switch") {
      state = seedHeld(frame[2], frame[1]);

      return ["switch"];
    }

    const step = stepPad(state, frame[1], frame[0], timing);
    ({ state } = step);

    return [...step.actions];
  });
};

const stickX = (x: number): PadSnapshot => pad([], [x, 0, 0, 0]);

describe(keyToAction, () => {
  it.each([
    ["ArrowUp", "up"],
    ["ArrowRight", "right"],
    ["Enter", "select"],
    ["Escape", "back"],
    ["MediaPlayPause", "playPause"],
    ["ContextMenu", "menu"],
  ])("%s -> %s", (key, action) => {
    expect(keyToAction(key)).toBe(action);
  });

  it("a held key repeats only directions; Select, Back, Menu and Play/Pause act once", () => {
    const keys = [
      "ArrowDown",
      "ArrowLeft",
      "Enter",
      " ",
      "Escape",
      "GoBack",
      "ContextMenu",
      "MediaPlayPause",
    ];

    expect(keys.map((key) => keyToAction(key, { repeat: true }))).toStrictEqual([
      "down",
      "left",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("unmapped keys and prototype names yield no action", () => {
    expect([keyToAction("a"), keyToAction("toString")]).toStrictEqual([undefined, undefined]);
  });

  it("while editing, keys that type or move the caret belong to the field", () => {
    const keys = [" ", "Backspace", "ArrowLeft", "ArrowRight", "a"];
    expect(keys.map((key) => keyToAction(key, { editing: true }))).toStrictEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(keys.map((key) => keyToAction(key))).toStrictEqual([
      "select",
      "back",
      "left",
      "right",
      undefined,
    ]);
  });

  it("while editing, keys that cannot type still act", () => {
    const keys = ["ArrowUp", "ArrowDown", "Enter", "Escape", "GoBack", "MediaPlayPause"];
    expect(keys.map((key) => keyToAction(key, { editing: true }))).toStrictEqual([
      "up",
      "down",
      "select",
      "back",
      "back",
      "playPause",
    ]);
  });

  it("editing: false behaves like no options", () => {
    expect(keyToAction(" ", { editing: false })).toBe("select");
  });
});

describe(isEditing, () => {
  it.each([
    [{ tagName: "INPUT", type: "text" }, true],
    [{ tagName: "INPUT", type: "password" }, true],
    [{ tagName: "INPUT" }, true],
    [{ tagName: "TEXTAREA" }, true],
    [{ tagName: "DIV", isContentEditable: true }, true],
    [{ tagName: "INPUT", type: "checkbox" }, false],
    [{ tagName: "INPUT", type: "text", readOnly: true }, false],
    [{ tagName: "BUTTON" }, false],
    [null, false],
  ])("%o -> %s", (target, editing) => {
    expect(isEditing(target)).toBe(editing);
  });
});

describe(stepPad, () => {
  it("fires once on the press edge, not while held, again after release", () => {
    expect(
      run([
        [0, pad([0])],
        [16, pad([0])],
        [32, pad([])],
        [48, pad([0])],
      ])
    ).toStrictEqual([["select"], [], [], ["select"]]);
  });

  it("maps the standard d-pad, face buttons and start", () => {
    expect(run([[0, pad([12, 1, 9])]])).toStrictEqual([["up", "back", "menu"]]);
  });

  it("left stick past the threshold acts as a direction, inside it does not", () => {
    expect(
      run([
        [0, pad([], [0.4, 0, 0, 0])],
        [16, pad([], [0.9, 0, 0, 0])],
        [32, pad([], [0, -0.9, 0, 0])],
      ])
    ).toStrictEqual([[], ["right"], ["up"]]);
  });

  it("stick enters at 0.5 and leaves only below 0.35", () => {
    expect(
      run([
        [0, stickX(0.49)],
        [16, stickX(0.5)],
        [32, stickX(0.35)],
        [48, stickX(0.34)],
        [64, stickX(0.49)],
        [80, stickX(0.5)],
      ])
    ).toStrictEqual([[], ["right"], [], [], [], ["right"]]);
  });

  it("a stick hovering between 0.45 and 0.55 makes one press edge", () => {
    expect(
      run([
        [0, stickX(0.55)],
        [16, stickX(0.45)],
        [32, stickX(0.55)],
        [48, stickX(0.45)],
        [64, stickX(0.55)],
        [80, stickX(0.45)],
      ])
    ).toStrictEqual([["right"], [], [], [], [], []]);
  });

  it("d-pad and stick in the same direction fire one action", () => {
    expect(run([[0, pad([15], [0.9, 0, 0, 0])]])).toStrictEqual([["right"]]);
  });

  it("a held direction repeats after the delay, then every interval", () => {
    expect(
      run([
        [0, pad([15])],
        [399, pad([15])],
        [400, pad([15])],
        [450, pad([15])],
        [500, pad([15])],
        [600, pad([15])],
      ])
    ).toStrictEqual([["right"], [], ["right"], [], ["right"], ["right"]]);
  });

  it("a held select never repeats", () => {
    expect(
      run([
        [0, pad([0])],
        [1000, pad([0])],
      ])
    ).toStrictEqual([["select"], []]);
  });
});

describe("seedHeld on an input mode switch", () => {
  it("B held across the switch fires nothing; release then press fires one back", () => {
    expect(
      run([
        ["switch", 0, pad([1])],
        [16, pad([1])],
        [1000, pad([1])],
        [1016, pad([])],
        [1032, pad([1])],
        [1048, pad([1])],
      ])
    ).toStrictEqual([["switch"], [], [], [], ["back"], []]);
  });

  it("a direction held across the switch never repeats until released", () => {
    expect(
      run([
        ["switch", 0, pad([15])],
        [400, pad([15])],
        [600, pad([15])],
        [616, pad([])],
        [632, pad([15])],
      ])
    ).toStrictEqual([["switch"], [], [], [], ["right"]]);
  });

  it("a stick held across the switch stays silent until it drops below 0.35", () => {
    expect(
      run([
        ["switch", 0, stickX(0.9)],
        [16, stickX(0.4)],
        [32, stickX(0.9)],
        [48, stickX(0.3)],
        [64, stickX(0.9)],
      ])
    ).toStrictEqual([["switch"], [], [], [], ["right"]]);
  });

  it("buttons pressed only after the switch fire normally", () => {
    expect(
      run([
        ["switch", 0, pad([1])],
        [16, pad([1, 0])],
      ])
    ).toStrictEqual([["switch"], ["select"]]);
  });
});

describe(route, () => {
  it("ui mode passes both sources", () => {
    expect([route("ui", "gamepad", "left"), route("ui", "keyboard", "left")]).toStrictEqual([
      "left",
      "left",
    ]);
  });

  it("player mode drops gamepad actions and keeps keyboard ones", () => {
    expect([
      route("player", "gamepad", "select"),
      route("player", "keyboard", "select"),
    ]).toStrictEqual([undefined, "select"]);
  });
});
