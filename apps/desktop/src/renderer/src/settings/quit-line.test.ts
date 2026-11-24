import { describe, expect, it } from "vitest";

import { quitLine } from "./quit-line";

describe(quitLine, () => {
  it.each([
    [undefined, "Closes the app"],
    [{ state: "unsupported" }, "Closes the app"],
    [{ state: "idle" }, "Closes the app"],
    [{ state: "available", version: "0.3.0" }, "Closes the app"],
    [{ state: "downloading", version: "0.3.0", percent: 41.6 }, "Closes the app"],
    [{ state: "failed", message: "net::ERR_FAILED" }, "Closes the app"],
    [{ state: "ready", version: "0.3.0" }, "Installs 0.3.0 as it closes"],
  ] as const)("quitLine(%o)", (status, line) => {
    expect(quitLine(status)).toBe(line);
  });
});
