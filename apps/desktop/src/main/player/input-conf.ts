import type { PlayerAction } from "./controls";

interface Binding {
  readonly keys: readonly string[];
  readonly action: PlayerAction;
  /** Held keys repeat at mpv's autorepeat rate, so holding right keeps seeking. */
  readonly repeat: boolean;
}

const BINDINGS: readonly Binding[] = [
  { keys: ["UP", "GAMEPAD_DPAD_UP"], action: "up", repeat: true },
  { keys: ["DOWN", "GAMEPAD_DPAD_DOWN"], action: "down", repeat: true },
  { keys: ["LEFT", "GAMEPAD_DPAD_LEFT"], action: "left", repeat: true },
  { keys: ["RIGHT", "GAMEPAD_DPAD_RIGHT"], action: "right", repeat: true },
  { keys: ["ENTER", "KP_ENTER", "GAMEPAD_ACTION_DOWN"], action: "select", repeat: false },
  { keys: ["ESC", "BS", "GAMEPAD_ACTION_RIGHT", "GAMEPAD_BACK"], action: "back", repeat: false },
  { keys: ["SPACE", "PLAYPAUSE", "GAMEPAD_START"], action: "playPause", repeat: false },
  { keys: ["MENU", "GAMEPAD_MENU"], action: "menu", repeat: false },
  { keys: ["CLOSE_WIN"], action: "stop", repeat: false },
];

/** The `input.conf` for the app-owned mpv config dir. mpv's own bindings are disabled. */
export const inputConf = (): string => {
  const lines = BINDINGS.flatMap(({ keys, action, repeat }) =>
    keys.map((key) => `${key} ${repeat ? "repeatable " : ""}script-message harakiri ${action}`)
  );

  return `${lines.join("\n")}\n`;
};
