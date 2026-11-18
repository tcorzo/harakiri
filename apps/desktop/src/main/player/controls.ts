import type { Action } from "@harakiri/input";
import { match, P } from "ts-pattern";

import type { TrackTable } from "./tracks";

/** What mpv's bindings send as `script-message harakiri <action>`. `stop` is the window's close button. */
export type PlayerAction = Action | "stop";

const PLAYER_ACTIONS: ReadonlySet<string> = new Set<PlayerAction>([
  "up",
  "down",
  "left",
  "right",
  "select",
  "back",
  "menu",
  "playPause",
  "stop",
]);

const isPlayerAction = (raw: string): raw is PlayerAction => PLAYER_ACTIONS.has(raw);

export const parsePlayerAction = (raw: string | undefined): PlayerAction | undefined =>
  raw !== undefined && isPlayerAction(raw) ? raw : undefined;

export const SEEK_BACK_SECONDS = -10;
export const SEEK_FORWARD_SECONDS = 30;

export interface MenuRow {
  readonly property: "aid" | "sid";
  readonly id: number | false;
  readonly label: string;
}

/** The track menu: every audio track, then subtitles led by "Off". */
export const menuRows = (tracks: TrackTable): MenuRow[] => [
  ...tracks.audio.map((t) => ({ property: "aid" as const, id: t.mpvId, label: t.label })),
  { property: "sid", id: false, label: "Off" },
  ...tracks.subtitles.map((t) => ({ property: "sid" as const, id: t.mpvId, label: t.label })),
];

export interface ControlsState {
  readonly visible: boolean;
  readonly paused: boolean;
  readonly aid: number | false | undefined;
  readonly sid: number | false | undefined;
  readonly menu: { readonly cursor: number } | null;
}

export const initialControls: ControlsState = {
  visible: true,
  paused: false,
  aid: undefined,
  sid: undefined,
  menu: null,
};

export type ControlsInput =
  | { readonly type: "action"; readonly action: PlayerAction }
  | { readonly type: "hide" }
  | { readonly type: "paused"; readonly paused: boolean }
  | {
      readonly type: "tracks";
      readonly aid: number | false | undefined;
      readonly sid: number | false | undefined;
    };

export type Command =
  | { readonly type: "pause"; readonly paused: boolean }
  | { readonly type: "seek"; readonly seconds: number }
  | { readonly type: "track"; readonly property: "aid" | "sid"; readonly id: number | false }
  | { readonly type: "stop" };

export interface Step {
  readonly state: ControlsState;
  readonly commands: readonly Command[];
}

const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), Math.max(max, 0));

const openMenu = (state: ControlsState, rows: readonly MenuRow[]): ControlsState => {
  const current = rows.findIndex((row) => row.property === "aid" && row.id === state.aid);

  return { ...state, menu: { cursor: Math.max(current, 0) } };
};

const onAction = (state: ControlsState, action: PlayerAction, rows: readonly MenuRow[]): Step => {
  const shown = { ...state, visible: true };

  const togglePause: Step = {
    state: shown,
    commands: [{ type: "pause", paused: !state.paused }],
  };

  return match({ menu: state.menu, action })
    .with({ action: "stop" }, () => ({ state: shown, commands: [{ type: "stop" } as const] }))
    .with({ action: "playPause" }, () => togglePause)
    .with({ menu: null, action: "select" }, () => togglePause)
    .with({ menu: null, action: "left" }, () => ({
      state: shown,
      commands: [{ type: "seek", seconds: SEEK_BACK_SECONDS } as const],
    }))
    .with({ menu: null, action: "right" }, () => ({
      state: shown,
      commands: [{ type: "seek", seconds: SEEK_FORWARD_SECONDS } as const],
    }))
    .with({ menu: null, action: P.union("up", "menu") }, () => ({
      state: openMenu(shown, rows),
      commands: [],
    }))
    .with({ menu: null, action: "down" }, () => ({ state: shown, commands: [] }))
    .with({ menu: null, action: "back" }, () => ({
      state: shown,
      commands: [{ type: "stop" } as const],
    }))
    .with({ menu: P.nonNullable, action: P.union("back", "menu") }, () => ({
      state: { ...shown, menu: null },
      commands: [],
    }))
    .with(
      { menu: P.nonNullable, action: P.union("up", "down") },
      ({ menu, action: direction }) => ({
        state: {
          ...shown,
          menu: { cursor: clamp(menu.cursor + (direction === "up" ? -1 : 1), rows.length - 1) },
        },
        commands: [],
      })
    )
    .with({ menu: P.nonNullable, action: P.union("left", "right") }, () => ({
      state: shown,
      commands: [],
    }))
    .with({ menu: P.nonNullable, action: "select" }, ({ menu }) => {
      const row = rows[menu.cursor];

      return {
        state: { ...shown, menu: null },
        commands: row ? [{ type: "track", property: row.property, id: row.id } as const] : [],
      };
    })
    .exhaustive();
};

/** The player's control logic: mpv input and mpv state in, new state and mpv commands out. */
export function step(state: ControlsState, input: ControlsInput, rows: readonly MenuRow[]): Step {
  return match(input)
    .with({ type: "action" }, ({ action }) => onAction(state, action, rows))
    .with({ type: "hide" }, () => ({
      // Paused or browsing tracks, the controls are the point; only playback hides them.
      state: state.paused || state.menu ? state : { ...state, visible: false },
      commands: [],
    }))
    .with({ type: "paused" }, ({ paused }) => ({
      state: { ...state, paused, visible: paused || state.visible },
      commands: [],
    }))
    .with({ type: "tracks" }, ({ aid, sid }) => ({ state: { ...state, aid, sid }, commands: [] }))
    .exhaustive();
}
