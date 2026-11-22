// @vitest-environment node
import { describe, expect, it } from "vitest";

import { softwareCompositing } from "./gpu";

describe(softwareCompositing, () => {
  it("says nothing while Chromium composites on the GPU", () => {
    for (const status of ["enabled", "enabled_on", "enabled_force", "enabled_force_on"]) {
      expect(softwareCompositing({ gpu_compositing: status })).toBeNull();
    }
  });

  it("returns the status when compositing fell back to software or is off", () => {
    expect(softwareCompositing({ gpu_compositing: "disabled_software" })).toBe("disabled_software");
    expect(softwareCompositing({ gpu_compositing: "unavailable_software" })).toBe(
      "unavailable_software"
    );
    expect(softwareCompositing({ gpu_compositing: "disabled_off" })).toBe("disabled_off");
  });

  it("returns a missing status as unknown", () => {
    expect(softwareCompositing({})).toBe("unknown");
  });
});
