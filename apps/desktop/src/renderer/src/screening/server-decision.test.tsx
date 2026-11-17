import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { ServerDecision } from "./screening-screen";

afterEach(cleanup);

test("the slug states the server's facts: a native leg bare, a mapped leg with its mark", () => {
  const { container } = render(
    <ServerDecision
      report={{
        facts: [
          { text: "Dolby Vision mapped to HDR10", state: "mapped" },
          { text: "TrueHD Atmos bitstream", state: "native" },
        ],
        downgrades: [],
        transcodeReasons: [],
        unreadable: false,
      }}
    />
  );

  const slug = screen.getByLabelText(
    "Signal path: Dolby Vision mapped to HDR10 · TrueHD Atmos bitstream"
  );

  expect(slug.textContent).toBe("Dolby Vision mapped to HDR10·TrueHD Atmos bitstream");
  expect(container.querySelectorAll("svg")).toHaveLength(1);
  expect(container.textContent).not.toMatch(/native|as it is/i);
});

test("a transcode states its reasons in plain words before mpv takes the screen", () => {
  render(
    <ServerDecision
      report={{
        facts: [],
        downgrades: [],
        transcodeReasons: ["Bitrate over the limit", "HDR format not supported"],
        unreadable: false,
      }}
    />
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "The server is converting this file instead of sending it as it is, because: Bitrate over the limit; HDR format not supported."
  );
});

test("a file the server could not read says so instead of showing a transcode", () => {
  render(
    <ServerDecision
      report={{
        facts: [],
        downgrades: [],
        transcodeReasons: ["Direct play failed"],
        unreadable: true,
      }}
    />
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "The server could not read this file, so it cannot send it as it is. Check that the server can open the file, then rescan the library."
  );
  expect(screen.queryByText(/converting/)).toBeNull();
});
