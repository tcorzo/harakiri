import { expect, test } from "vitest";
import { outputFromPactl } from "./audio-output";

const info = { default_sink_name: "alsa_output.hdmi" };

test("an HDMI sink with passthrough on takes exactly the codecs PipeWire lists", () => {
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
    ]),
  ).toEqual({ kind: "known", name: "AV receiver", bitstream: ["ac3", "eac3", "truehd", "dts-hd"] });
});

test("a format carrying PipeWire's rate attribute still names its codec", () => {
  const rate = 'format.rate = "{ \\"min\\": 32000, \\"max\\": 192000 }"';
  expect(
    outputFromPactl(info, [
      {
        name: "alsa_output.hdmi",
        description: "AV receiver",
        formats: [
          "pcm",
          `dts-iec61937, ${rate}`,
          `ac3-iec61937, ${rate}`,
          `eac3-iec61937, ${rate}`,
          `truehd-iec61937, ${rate}`,
          `dtshd-iec61937, ${rate}`,
        ],
      },
    ]),
  ).toEqual({
    kind: "known",
    name: "AV receiver",
    bitstream: ["dts", "ac3", "eac3", "truehd", "dts-hd"],
  });
});

test("an analog sink takes no bitstream", () => {
  expect(
    outputFromPactl({ default_sink_name: "usb-interface" }, [
      { name: "usb-interface", description: "USB interface", formats: ["pcm"] },
    ]),
  ).toEqual({ kind: "known", name: "USB interface", bitstream: [] });
});

test("a default sink missing from the list is unknown", () => {
  expect(outputFromPactl(info, [])).toEqual({
    kind: "unknown",
    detail: "default sink alsa_output.hdmi is not listed",
  });
});
