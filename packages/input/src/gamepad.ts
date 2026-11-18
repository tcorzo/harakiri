import { actions, isDirection, type Action } from "./action";

/** The slice of the DOM `Gamepad` this module reads, so a real pad or a plain object both fit. */
export interface PadSnapshot {
  readonly buttons: readonly { readonly pressed: boolean }[];
  readonly axes: readonly number[];
}

export interface RepeatTiming {
  readonly delayMs: number;
  readonly intervalMs: number;
}

interface Hold {
  readonly pressedAt: number;
  readonly firedAt: number;
  /** The stick is past its threshold for this action, so it leaves at `stickExit`, not `stickEnter`. */
  readonly stick: boolean;
  /** Held across an input mode switch: it never fires until released. */
  readonly silenced: boolean;
}

/** Held actions and when they last fired. Start from `idlePad`. */
export type PadState = ReadonlyMap<Action, Hold>;

export interface PadStep {
  readonly state: PadState;
  readonly actions: readonly Action[];
}

export const idlePad: PadState = new Map();

export const defaultRepeat: RepeatTiming = { delayMs: 400, intervalMs: 120 };

// W3C "standard" mapping indices.
const buttonActions: ReadonlyMap<number, Action> = new Map([
  [0, "select"],
  [1, "back"],
  [3, "playPause"],
  [8, "back"],
  [9, "menu"],
  [12, "up"],
  [13, "down"],
  [14, "left"],
  [15, "right"],
]);

// Hysteresis, so a stick resting near one threshold cannot chatter press edges.
const stickEnter = 0.5;
const stickExit = 0.35;

const axisActions: readonly { axis: number; sign: -1 | 1; action: Action }[] = [
  { axis: 0, sign: -1, action: "left" },
  { axis: 0, sign: 1, action: "right" },
  { axis: 1, sign: -1, action: "up" },
  { axis: 1, sign: 1, action: "down" },
];

interface Contact {
  readonly stick: boolean;
}

function contacts(prev: PadState, pad: PadSnapshot): ReadonlyMap<Action, Contact> {
  const active = new Map<Action, Contact>();
  for (const [index, action] of buttonActions) {
    if (pad.buttons[index]?.pressed === true) active.set(action, { stick: false });
  }
  for (const { axis, sign, action } of axisActions) {
    const threshold = prev.get(action)?.stick === true ? stickExit : stickEnter;
    if ((pad.axes[axis] ?? 0) * sign >= threshold) active.set(action, { stick: true });
  }
  return active;
}

/**
 * Advances the pad state to `now`: fires on press edges, and repeats held
 * directions after `delayMs`, then every `intervalMs`.
 */
export function stepPad(
  prev: PadState,
  pad: PadSnapshot,
  now: number,
  timing: RepeatTiming = defaultRepeat
): PadStep {
  const active = contacts(prev, pad);
  const state = new Map<Action, Hold>();
  const fired: Action[] = [];
  for (const action of actions) {
    const contact = active.get(action);
    if (contact === undefined) continue;
    const hold = prev.get(action);
    if (hold === undefined) {
      state.set(action, { pressedAt: now, firedAt: now, stick: contact.stick, silenced: false });
      fired.push(action);
      continue;
    }
    const repeated = hold.firedAt !== hold.pressedAt;
    const repeats =
      !hold.silenced &&
      isDirection(action) &&
      (repeated ? now - hold.firedAt >= timing.intervalMs : now - hold.pressedAt >= timing.delayMs);
    state.set(action, { ...hold, stick: contact.stick, firedAt: repeats ? now : hold.firedAt });
    if (repeats) fired.push(action);
  }
  return { state, actions: fired };
}

/**
 * The pad state right after an input mode switch: everything held in `pad`
 * stays silent until released, so the press that switched modes (B or Start
 * ending playback in mpv) does not also act in the new mode.
 */
export function seedHeld(pad: PadSnapshot, now: number): PadState {
  const state = new Map<Action, Hold>();
  for (const [action, contact] of contacts(idlePad, pad)) {
    state.set(action, { pressedAt: now, firedAt: now, stick: contact.stick, silenced: true });
  }
  return state;
}
