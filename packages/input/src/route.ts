import type { Action, InputMode, InputSource } from "./action";

// While mpv plays it reads the pad itself (--input-gamepad), so the renderer must not act on it too.
const accepts: Readonly<Record<InputMode, Readonly<Record<InputSource, boolean>>>> = {
  ui: { keyboard: true, gamepad: true },
  player: { keyboard: true, gamepad: false },
};

export const route = (mode: InputMode, source: InputSource, action: Action): Action | undefined =>
  accepts[mode][source] ? action : undefined;
