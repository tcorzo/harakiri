import { doesFocusableExist, setFocus } from "@noriginmedia/norigin-spatial-navigation";

/**
 * Focuses the first of `keys` that is mounted. norigin accepts any key, and an unregistered one
 * leaves it with nothing to navigate from, so the d-pad goes dead; this never hands it one.
 */
export function focusFirst(...keys: readonly string[]): boolean {
  const key = keys.find((candidate) => doesFocusableExist(candidate));

  if (key === undefined) return false;
  void setFocus(key);

  return true;
}
