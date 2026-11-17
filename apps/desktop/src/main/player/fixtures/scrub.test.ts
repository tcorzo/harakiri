// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { scrubPlaybackInfo } from "@harakiri/jellyfin/fixture-scrub";
import { expect, test } from "vitest";
import { z } from "zod";

test("every recorded PlaybackInfo fixture is already scrubbed of the library it came from", () => {
  const names = readdirSync(import.meta.dirname).filter((file) => file.endsWith(".json"));
  expect(names).toHaveLength(11);
  for (const file of names) {
    const json = z
      .record(z.string(), z.unknown())
      .parse(JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8")));
    expect({ file, json }).toEqual({ file, json: scrubPlaybackInfo(json, file.slice(0, -5)) });
  }
});
