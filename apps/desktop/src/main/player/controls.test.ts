// @vitest-environment node
import { describe, expect, test } from "vitest";

import {
  type ControlsInput,
  type ControlsState,
  initialControls,
  menuRows,
  parsePlayerAction,
  type PlayerAction,
  step,
} from "./controls";

const rows = menuRows({
  audio: [
    { index: 3, mpvId: 1, label: "Japanese TrueHD" },
    { index: 4, mpvId: 2, label: "English TrueHD" },
  ],
  subtitles: [{ index: 7, mpvId: 1, label: "English PGS" }],
  subtitleFiles: [],
});

const playing: ControlsState = { ...initialControls, visible: false, aid: 2, sid: false };
const press = (action: PlayerAction): ControlsInput => ({ type: "action", action });

const run = (state: ControlsState, ...inputs: ControlsInput[]) =>
  inputs.reduce<{ state: ControlsState; commands: unknown[] }>(
    (acc, input) => {
      const next = step(acc.state, input, rows);

      return { state: next.state, commands: [...acc.commands, ...next.commands] };
    },
    { state, commands: [] }
  );

test("the menu lists audio, then subtitles led by Off", () => {
  expect(rows).toEqual([
    { property: "aid", id: 1, label: "Japanese TrueHD" },
    { property: "aid", id: 2, label: "English TrueHD" },
    { property: "sid", id: false, label: "Off" },
    { property: "sid", id: 1, label: "English PGS" },
  ]);
});

describe("without the menu", () => {
  test("select toggles pause and shows the controls", () => {
    expect(step(playing, press("select"), rows)).toEqual({
      state: { ...playing, visible: true },
      commands: [{ type: "pause", paused: true }],
    });
  });

  test("left and right seek back 10 s and forward 30 s", () => {
    expect(run(playing, press("left"), press("right")).commands).toEqual([
      { type: "seek", seconds: -10 },
      { type: "seek", seconds: 30 },
    ]);
  });

  test("back stops playback", () => {
    expect(step(playing, press("back"), rows).commands).toEqual([{ type: "stop" }]);
  });

  test("up opens the menu on the audio track in use", () => {
    expect(step(playing, press("up"), rows).state.menu).toEqual({ cursor: 1 });
  });
});

describe("with the menu open", () => {
  test("down moves to a subtitle and select switches to it and closes the menu", () => {
    expect(run(playing, press("up"), press("down"), press("down"), press("select"))).toEqual({
      state: { ...playing, visible: true, menu: null },
      commands: [{ type: "track", property: "sid", id: 1 }],
    });
  });

  test("the cursor stops at both ends of the list", () => {
    const top = run(playing, press("up"), press("up"), press("up"), press("up"));
    expect(top.state.menu).toEqual({ cursor: 0 });
    const bottom = run(playing, press("up"), ...Array.from({ length: 8 }, () => press("down")));
    expect(bottom.state.menu).toEqual({ cursor: 3 });
  });

  test("back closes the menu without stopping, and seeking is off", () => {
    expect(run(playing, press("up"), press("left"), press("back"))).toEqual({
      state: { ...playing, visible: true, menu: null },
      commands: [],
    });
  });

  test("choosing Off turns subtitles off", () => {
    expect(run(playing, press("up"), press("down"), press("select")).commands).toEqual([
      { type: "track", property: "sid", id: false },
    ]);
  });
});

describe("auto-hide", () => {
  test("hides while playing", () => {
    expect(step({ ...playing, visible: true }, { type: "hide" }, rows).state.visible).toBe(false);
  });

  test("stays while paused or while the menu is open", () => {
    const paused = run(playing, { type: "paused", paused: true }, { type: "hide" });
    expect(paused.state).toEqual({ ...playing, paused: true, visible: true });
    const browsing = run(playing, press("up"), { type: "hide" });
    expect(browsing.state.visible).toBe(true);
  });
});

test("observed tracks replace the state's aid and sid", () => {
  expect(step(playing, { type: "tracks", aid: 1, sid: 3 }, rows).state).toEqual({
    ...playing,
    aid: 1,
    sid: 3,
  });
});

test("parsePlayerAction accepts the bound actions only", () => {
  expect([
    parsePlayerAction("select"),
    parsePlayerAction("stop"),
    parsePlayerAction("quit"),
  ]).toEqual(["select", "stop", undefined]);
});
