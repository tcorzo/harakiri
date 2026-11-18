import { isDirection } from "./action";
import type { Action } from "./action";

interface KeyBinding {
  readonly action: Action;
  /** Whether the key still acts while a text field has focus, i.e. it types nothing and moves no caret. */
  readonly whileEditing: boolean;
}

// Fields are single-line: ArrowUp/Down leave the field, ArrowLeft/Right move the caret.
const keyBindings: Readonly<Record<string, KeyBinding>> = {
  ArrowUp: { action: "up", whileEditing: true },
  ArrowDown: { action: "down", whileEditing: true },
  ArrowLeft: { action: "left", whileEditing: false },
  ArrowRight: { action: "right", whileEditing: false },
  Enter: { action: "select", whileEditing: true },
  " ": { action: "select", whileEditing: false },
  Escape: { action: "back", whileEditing: true },
  Backspace: { action: "back", whileEditing: false },
  BrowserBack: { action: "back", whileEditing: true },
  GoBack: { action: "back", whileEditing: true },
  ContextMenu: { action: "menu", whileEditing: true },
  MediaPlayPause: { action: "playPause", whileEditing: true },
};

export interface KeyContext {
  /** A text field has focus, so keys that type or move the caret belong to it. */
  readonly editing?: boolean;
  /** The key is auto-repeating because it is held (`KeyboardEvent.repeat`). */
  readonly repeat?: boolean;
}

export function keyToAction(
  key: string,
  { editing = false, repeat = false }: KeyContext = {}
): Action | undefined {
  const binding = Object.hasOwn(keyBindings, key) ? keyBindings[key] : undefined;

  if (binding === undefined || (editing && !binding.whileEditing)) {
    return undefined;
  }

  // Holding a direction scrolls, as the gamepad repeats it; remotes repeat every key on a long
  // press, and a held Select or Back must act once, not start a film and then back out of it.
  if (repeat && !isDirection(binding.action)) {
    return undefined;
  }

  return binding.action;
}

/** The slice of a DOM `Element` that decides whether it takes typing. */
export interface FocusTarget {
  readonly tagName: string;
  readonly type?: string;
  readonly readOnly?: boolean;
  readonly isContentEditable?: boolean;
}

const textInputTypes: ReadonlySet<string> = new Set([
  "text",
  "search",
  "password",
  "email",
  "url",
  "tel",
  "number",
]);

/** Whether keys pressed on `target` are typing, which is what `keyToAction`'s `editing` means. */
export function isEditing(target: FocusTarget | null | undefined): boolean {
  if (target == null) {
    return false;
  }

  if (target.isContentEditable === true) {
    return true;
  }

  if (target.readOnly === true) {
    return false;
  }
  const tag = target.tagName.toUpperCase();

  return tag === "TEXTAREA" || (tag === "INPUT" && textInputTypes.has(target.type ?? "text"));
}
