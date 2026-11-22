/** Versioned, so a later card with other terms can ask again. The value is a plain marker. */
const key = "harakiri:launcher-card:v1";

/** Whether the owner chose Not now. Storage that is blocked or missing reads as never chosen. */
export const isDismissed = (): boolean => {
  try {
    return localStorage.getItem(key) === "dismissed";
  } catch {
    return false;
  }
};

/** Remembers Not now. Without storage the card returns at the next start, which is harmless. */
export const dismiss = (): void => {
  try {
    localStorage.setItem(key, "dismissed");
  } catch {
    // Nothing to keep it in: Settings still offers the action.
  }
};
