import { doesFocusableExist, setFocus } from "@noriginmedia/norigin-spatial-navigation";

/** The open sheet: while it is set, nothing outside it can take focus. */
let held: HTMLElement | null = null;

const reachable = (key: string): boolean =>
  held === null || held.querySelector(`[data-focus-key="${CSS.escape(key)}"]`) !== null;

/**
 * Keeps focus inside `node` until the returned release runs, so something that arrives under a
 * sheet (a card whose data came late) cannot pull focus out from behind it.
 */
export const holdFocusWithin = (node: HTMLElement): (() => void) => {
  held = node;

  return () => {
    if (held === node) {
      held = null;
    }
  };
};

/**
 * Focuses the first of `keys` that is mounted. norigin accepts any key, and an unregistered one
 * leaves it with nothing to navigate from, so the d-pad goes dead; this never hands it one.
 */
export const focusFirst = (...keys: readonly string[]): boolean => {
  const key = keys.find((candidate) => doesFocusableExist(candidate) && reachable(candidate));

  if (key === undefined) {
    return false;
  }

  void setFocus(key);

  return true;
};
