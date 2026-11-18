import { describe, expect, test } from "vitest";

import {
  idlePad,
  isEditing,
  keyToAction,
  route,
  seedHeld,
  stepPad,
  type PadSnapshot,
  type PadState,
} from "./index";

const timing = { delayMs: 400, intervalMs: 100 };

function pad(pressed: readonly number[], axes: readonly number[] = [0, 0, 0, 0]): PadSnapshot {
  return {
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
    axes,
  };
}

/** A frame polls the pad; a `switch` frame is an input mode change, as the hub handles it. */
type Frame = readonly [number, PadSnapshot] | readonly ["switch", number, PadSnapshot];

function run(frames: readonly Frame[]): string[][] {
  let state: PadState = idlePad;

  return frames.map((frame) => {
    if (frame[0] === "switch") {
      state = seedHeld(frame[2], frame[1]);

      return ["switch"];
    }

    const step = stepPad(state, frame[1], frame[0], timing);
    state = step.state;

    return [...step.actions];
  });
}

function stickX(x: number): PadSnapshot {
  return pad([], [x, 0, 0, 0]);
}

describe("keyToAction", () => {
  test.each([
    ["ArrowUp", "up"],
    ["ArrowRight", "right"],
    ["Enter", "select"],
    ["Escape", "back"],
    ["MediaPlayPause", "playPause"],
    ["ContextMenu", "menu"],
  ])("%s -> %s", (key, action) => {
    expect(keyToAction(key)).toBe(action);
  });

  test("a held key repeats only directions; Select, Back, Menu and Play/Pause act once", () => {
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

    expect(keys.map((key) => keyToAction(key, { repeat: true }))).toEqual([
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

  test("unmapped keys and prototype names yield no action", () => {
    expect([keyToAction("a"), keyToAction("toString")]).toEqual([undefined, undefined]);
  });

  test("while editing, keys that type or move the caret belong to the field", () => {
    const keys = [" ", "Backspace", "ArrowLeft", "ArrowRight", "a"];
    expect(keys.map((key) => keyToAction(key, { editing: true }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(keys.map((key) => keyToAction(key))).toEqual([
      "select",
      "back",
      "left",
      "right",
      undefined,
    ]);
  });

  test("while editing, keys that cannot type still act", () => {
    const keys = ["ArrowUp", "ArrowDown", "Enter", "Escape", "GoBack", "MediaPlayPause"];
    expect(keys.map((key) => keyToAction(key, { editing: true }))).toEqual([
      "up",
      "down",
      "select",
      "back",
      "back",
      "playPause",
    ]);
  });

  test("editing: false behaves like no options", () => {
    expect(keyToAction(" ", { editing: false })).toBe("select");
  });
});

describe("isEditing", () => {
  test.each([
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

describe("stepPad", () => {
  test("fires once on the press edge, not while held, again after release", () => {
    expect(
      run([
        [0, pad([0])],
        [16, pad([0])],
        [32, pad([])],
        [48, pad([0])],
      ])
    ).toEqual([["select"], [], [], ["select"]]);
  });

  test("maps the standard d-pad, face buttons and start", () => {
    expect(run([[0, pad([12, 1, 9])]])).toEqual([["up", "back", "menu"]]);
  });

  test("left stick past the threshold acts as a direction, inside it does not", () => {
    expect(
      run([
        [0, pad([], [0.4, 0, 0, 0])],
        [16, pad([], [0.9, 0, 0, 0])],
        [32, pad([], [0, -0.9, 0, 0])],
      ])
    ).toEqual([[], ["right"], ["up"]]);
  });

  test("stick enters at 0.5 and leaves only below 0.35", () => {
    expect(
      run([
        [0, stickX(0.49)],
        [16, stickX(0.5)],
        [32, stickX(0.35)],
        [48, stickX(0.34)],
        [64, stickX(0.49)],
        [80, stickX(0.5)],
      ])
    ).toEqual([[], ["right"], [], [], [], ["right"]]);
  });

  test("a stick hovering between 0.45 and 0.55 makes one press edge", () => {
    expect(
      run([
        [0, stickX(0.55)],
        [16, stickX(0.45)],
        [32, stickX(0.55)],
        [48, stickX(0.45)],
        [64, stickX(0.55)],
        [80, stickX(0.45)],
      ])
    ).toEqual([["right"], [], [], [], [], []]);
  });

  test("d-pad and stick in the same direction fire one action", () => {
    expect(run([[0, pad([15], [0.9, 0, 0, 0])]])).toEqual([["right"]]);
  });

  test("a held direction repeats after the delay, then every interval", () => {
    expect(
      run([
        [0, pad([15])],
        [399, pad([15])],
        [400, pad([15])],
        [450, pad([15])],
        [500, pad([15])],
        [600, pad([15])],
      ])
    ).toEqual([["right"], [], ["right"], [], ["right"], ["right"]]);
  });

  test("a held select never repeats", () => {
    expect(
      run([
        [0, pad([0])],
        [1000, pad([0])],
      ])
    ).toEqual([["select"], []]);
  });
});

describe("seedHeld on an input mode switch", () => {
  test("B held across the switch fires nothing; release then press fires one back", () => {
    expect(
      run([
        ["switch", 0, pad([1])],
        [16, pad([1])],
        [1000, pad([1])],
        [1016, pad([])],
        [1032, pad([1])],
        [1048, pad([1])],
      ])
    ).toEqual([["switch"], [], [], [], ["back"], []]);
  });

  test("a direction held across the switch never repeats until released", () => {
    expect(
      run([
        ["switch", 0, pad([15])],
        [400, pad([15])],
        [600, pad([15])],
        [616, pad([])],
        [632, pad([15])],
      ])
    ).toEqual([["switch"], [], [], [], ["right"]]);
  });

  test("a stick held across the switch stays silent until it drops below 0.35", () => {
    expect(
      run([
        ["switch", 0, stickX(0.9)],
        [16, stickX(0.4)],
        [32, stickX(0.9)],
        [48, stickX(0.3)],
        [64, stickX(0.9)],
      ])
    ).toEqual([["switch"], [], [], [], ["right"]]);
  });

  test("buttons pressed only after the switch fire normally", () => {
    expect(
      run([
        ["switch", 0, pad([1])],
        [16, pad([1, 0])],
      ])
    ).toEqual([["switch"], ["select"]]);
  });
});

describe("route", () => {
  test("ui mode passes both sources", () => {
    expect([route("ui", "gamepad", "left"), route("ui", "keyboard", "left")]).toEqual([
      "left",
      "left",
    ]);
  });

  test("player mode drops gamepad actions and keeps keyboard ones", () => {
    expect([route("player", "gamepad", "select"), route("player", "keyboard", "select")]).toEqual([
      undefined,
      "select",
    ]);
  });
});
