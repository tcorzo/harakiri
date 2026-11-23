import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FormatLogo } from "../data/entry";
import { FormatLogoMark } from "./marks";

// Every logo, so a new one cannot skip the check.
const every = {
  "dolby-vision": true,
  hdr10: true,
  "hdr10-plus": true,
  "dolby-atmos": true,
  "dolby-truehd": true,
  "dolby-digital-plus": true,
  "dolby-digital": true,
  dts: true,
} satisfies Record<FormatLogo, true>;

const logos = Object.keys(every).filter((key): key is FormatLogo => key in every);

describe("format logos", () => {
  // The packaged renderer runs from file://, and Chromium fetches a CSS mask image in CORS mode,
  // which file:// cannot answer: a logo served as a file paints nothing there.
  it.each(logos)("%s is drawn from a data URL, which file:// can mask with", (logo) => {
    const { container } = render(<FormatLogoMark logo={logo} />);
    const mark = container.querySelector("span");

    expect(mark?.style.maskImage).toMatch(/^url\("data:image\/svg\+xml/u);
  });
});
