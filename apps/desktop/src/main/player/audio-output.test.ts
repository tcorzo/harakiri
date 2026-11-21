// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { encodingOf, outputFromPactl } from "./audio-output";

const info = { default_sink_name: "alsa_output.hdmi" };

describe("audio output from pactl", () => {
  it("an HDMI sink with passthrough on takes exactly the codecs PipeWire lists", () => {
    expect(
      outputFromPactl(info, [
        { name: "alsa_output.analog", description: "Headset", formats: ["pcm"] },
        {
          name: "alsa_output.hdmi",
          description: "AV receiver",
          formats: [
            "pcm",
            "ac3-iec61937",
            "eac3-iec61937",
            "truehd-iec61937",
            "dtshd-iec61937",
            "mpeg-iec61937",
          ],
        },
      ])
    ).toStrictEqual({
      kind: "known",
      name: "AV receiver",
      bitstream: ["ac3", "eac3", "truehd", "dts-hd"],
    });
  });

  it("an analog sink takes no bitstream", () => {
    expect(
      outputFromPactl({ default_sink_name: "usb-interface" }, [
        { name: "usb-interface", description: "USB interface", formats: ["pcm"] },
      ])
    ).toStrictEqual({ kind: "known", name: "USB interface", bitstream: [] });
  });

  it("a default sink missing from the list is unknown", () => {
    expect(outputFromPactl(info, [])).toStrictEqual({
      kind: "unknown",
      detail: "default sink alsa_output.hdmi is not listed",
    });
  });

  it("PipeWire's attribute-suffixed formats still name their codecs", () => {
    const fixture = z
      .object({
        info: z.object({ default_sink_name: z.string() }),
        sinks: z.array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            formats: z.array(z.string()),
          })
        ),
      })
      .parse(
        JSON.parse(
          readFileSync(new URL("fixtures/pactl-fake-spdif.json", import.meta.url), "utf-8")
        )
      );

    expect(outputFromPactl(fixture.info, fixture.sinks)).toStrictEqual({
      kind: "known",
      name: "Fake S/PDIF",
      bitstream: ["dts", "ac3", "eac3", "truehd", "dts-hd"],
    });
  });

  it.each([
    ['truehd-iec61937,format.rate = "{ \\"min\\": 1, \\"max\\": -1 }"', "truehd-iec61937"],
    ['  ac3-iec61937 , format.channels = "6"', "ac3-iec61937"],
    ["pcm", "pcm"],
  ])("encodingOf(%j) is %j", (format, encoding) => {
    expect(encodingOf(format)).toBe(encoding);
  });

  it("an encoding harakiri does not bitstream is ignored, attributes or not", () => {
    expect(
      outputFromPactl(info, [
        {
          name: "alsa_output.hdmi",
          description: "AV receiver",
          formats: ["pcm", 'mpeg-iec61937, format.rate = "{ \\"min\\": 1, \\"max\\": -1 }"'],
        },
      ])
    ).toStrictEqual({ kind: "known", name: "AV receiver", bitstream: [] });
  });
});
