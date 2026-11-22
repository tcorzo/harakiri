import { afterEach, describe, expect, it } from "vitest";

import { dismiss, isDismissed } from "./dismissal";

const storage = Object.getOwnPropertyDescriptor(window, "localStorage");

describe("dismissal", () => {
  afterEach(() => {
    if (storage === undefined) {
      Reflect.deleteProperty(window, "localStorage");
    } else {
      Object.defineProperty(window, "localStorage", storage);
    }

    localStorage.clear();
  });

  it("remembers Not now under its versioned key", () => {
    expect(isDismissed()).toBe(false);
    dismiss();
    expect([isDismissed(), localStorage.getItem("harakiri:launcher-card:v1")]).toStrictEqual([
      true,
      "dismissed",
    ]);
  });

  it("storage that throws on access reads as not dismissed, and dismissing is silent", () => {
    // A blocked profile throws from the getter itself, before any method runs.
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    expect(isDismissed()).toBe(false);
    expect(dismiss).not.toThrow();
  });
});
