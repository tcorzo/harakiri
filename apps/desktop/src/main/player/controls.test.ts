// @vitest-environment node
import { describe, expect, it } from "vitest";

import { initialControls, menuRows, parsePlayerAction, step } from "./controls";
import type { Command, ControlsInput, ControlsState, PlayerAction, Step } from "./controls";

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

const run = (state: ControlsState, ...inputs: ControlsInput[]): Step => {
  let current = state;
  const commands: Command[] = [];

  for (const input of inputs) {
    const next = step(current, input, rows);
    current = next.state;
    commands.push(...next.commands);
  }

  return { state: current, commands };
};

describe("player controls", () => {
  it("the menu lists audio, then subtitles led by Off", () => {
    expect(rows).toStrictEqual([
      { property: "aid", id: 1, label: "Japanese TrueHD" },
      { property: "aid", id: 2, label: "English TrueHD" },
      { property: "sid", id: false, label: "Off" },
      { property: "sid", id: 1, label: "English PGS" },
    ]);
  });

  describe("without the menu", () => {
    it("select toggles pause and shows the controls", () => {
      expect(step(playing, press("select"), rows)).toStrictEqual({
        state: { ...playing, visible: true },
        commands: [{ type: "pause", paused: true }],
      });
    });

    it("left and right seek back 10 s and forward 30 s", () => {
      expect(run(playing, press("left"), press("right")).commands).toStrictEqual([
        { type: "seek", seconds: -10 },
        { type: "seek", seconds: 30 },
      ]);
    });

    it("back stops playback", () => {
      expect(step(playing, press("back"), rows).commands).toStrictEqual([{ type: "stop" }]);
    });

    it("up opens the menu on the audio track in use", () => {
      expect(step(playing, press("up"), rows).state.menu).toStrictEqual({ cursor: 1 });
    });
  });

  describe("with the menu open", () => {
    it("down moves to a subtitle and select switches to it and closes the menu", () => {
      expect(
        run(playing, press("up"), press("down"), press("down"), press("select"))
      ).toStrictEqual({
        state: { ...playing, visible: true, menu: null },
        commands: [{ type: "track", property: "sid", id: 1 }],
      });
    });

    it("the cursor stops at both ends of the list", () => {
      const top = run(playing, press("up"), press("up"), press("up"), press("up"));
      expect(top.state.menu).toStrictEqual({ cursor: 0 });
      const bottom = run(playing, press("up"), ...Array.from({ length: 8 }, () => press("down")));
      expect(bottom.state.menu).toStrictEqual({ cursor: 3 });
    });

    it("back closes the menu without stopping, and seeking is off", () => {
      expect(run(playing, press("up"), press("left"), press("back"))).toStrictEqual({
        state: { ...playing, visible: true, menu: null },
        commands: [],
      });
    });

    it("choosing Off turns subtitles off", () => {
      expect(run(playing, press("up"), press("down"), press("select")).commands).toStrictEqual([
        { type: "track", property: "sid", id: false },
      ]);
    });
  });

  describe("auto-hide", () => {
    it("hides while playing", () => {
      expect(step({ ...playing, visible: true }, { type: "hide" }, rows).state.visible).toBe(false);
    });

    it("stays while paused or while the menu is open", () => {
      const paused = run(playing, { type: "paused", paused: true }, { type: "hide" });
      expect(paused.state).toStrictEqual({ ...playing, paused: true, visible: true });
      const browsing = run(playing, press("up"), { type: "hide" });
      expect(browsing.state.visible).toBe(true);
    });
  });

  it("observed tracks replace the state's aid and sid", () => {
    expect(step(playing, { type: "tracks", aid: 1, sid: 3 }, rows).state).toStrictEqual({
      ...playing,
      aid: 1,
      sid: 3,
    });
  });

  it("parsePlayerAction accepts the bound actions only", () => {
    expect([
      parsePlayerAction("select"),
      parsePlayerAction("stop"),
      parsePlayerAction("quit"),
    ]).toStrictEqual(["select", "stop", undefined]);
  });
});
