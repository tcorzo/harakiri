import { expect, test } from "vitest";

import { versionLine } from "./version-line";

test.each([
  [undefined, "Version 0.2.0"],
  [{ state: "unsupported" }, "Version 0.2.0"],
  [{ state: "idle" }, "Version 0.2.0 · up to date"],
  [
    { state: "available", version: "0.3.0" },
    "Version 0.2.0 · 0.3.0 found, downloads when playback stops",
  ],
  [
    { state: "downloading", version: "0.3.0", percent: 41.6 },
    "Version 0.2.0 · 0.3.0 downloading 42%",
  ],
  [{ state: "ready", version: "0.3.0" }, "Version 0.2.0 · 0.3.0 ready, installs when you quit"],
  [
    { state: "failed", message: "net::ERR_FAILED" },
    "Version 0.2.0 · update failed, tries again later",
  ],
] as const)("versionLine(%o)", (status, line) => {
  expect(versionLine("0.2.0", status)).toBe(line);
});
