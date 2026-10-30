export const actions = [
  "up",
  "down",
  "left",
  "right",
  "select",
  "back",
  "menu",
  "playPause",
] as const;

export type Action = (typeof actions)[number];

export type Direction = Extract<Action, "up" | "down" | "left" | "right">;

export type InputMode = "ui" | "player";

export type InputSource = "keyboard" | "gamepad";

const directions: ReadonlySet<Action> = new Set<Direction>(["up", "down", "left", "right"]);

export function isDirection(action: Action): action is Direction {
  return directions.has(action);
}
