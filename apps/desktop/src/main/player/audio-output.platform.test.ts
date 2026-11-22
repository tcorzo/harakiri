// @vitest-environment node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { readAudioOutput } from "./audio-output";

// oxlint-disable-next-line typescript/strict-void-return -- execFile has no promise form; promisify types it through Node's own __promisify__ overload
const run = promisify(execFile);

const Sinks = z.array(z.object({ name: z.string(), formats: z.array(z.string()) }));

describe("the fake S/PDIF sink in the guest", () => {
  it("PipeWire lists the fake sink's codecs with attributes, as the HTPC does (#8)", async () => {
    const { stdout } = await run("pactl", ["--format=json", "list", "sinks"]);
    const sink = Sinks.parse(JSON.parse(stdout)).find((s) => s.name === "fake-spdif");

    expect(sink?.formats).toContain("pcm");
    expect(
      sink?.formats.filter((f) => /^[a-z0-9]+-iec61937, format\.rate = /u.test(f))
    ).toHaveLength(5);
  });

  it("readAudioOutput reports all five bitstream codecs on the fake S/PDIF sink", async () => {
    const output = await readAudioOutput();

    expect(
      output.kind === "known"
        ? { name: output.name, bitstream: output.bitstream.toSorted() }
        : output
    ).toStrictEqual({
      name: "Fake S/PDIF",
      bitstream: ["ac3", "dts", "dts-hd", "eac3", "truehd"],
    });
  });
});
