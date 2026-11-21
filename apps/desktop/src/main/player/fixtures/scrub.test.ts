// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";

import { scrubPlaybackInfo } from "@harakiri/jellyfin/fixture-scrub";
import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("recorded PlaybackInfo fixtures", () => {
  it("every recorded PlaybackInfo fixture is already scrubbed of the library it came from", () => {
    // pactl-* fixtures are PipeWire sink listings, not recorded PlaybackInfo responses.
    const names = readdirSync(import.meta.dirname).filter(
      (file) => file.endsWith(".json") && !file.startsWith("pactl-")
    );

    expect(names).toHaveLength(11);

    for (const file of names) {
      const json = z
        .record(z.string(), z.unknown())
        .parse(JSON.parse(readFileSync(new URL(file, import.meta.url), "utf-8")));

      expect({ file, json }).toStrictEqual({
        file,
        json: scrubPlaybackInfo(json, file.slice(0, -5)),
      });
    }
  });
});
