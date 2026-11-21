// @vitest-environment node
import { fidelityView } from "@harakiri/fidelity";
import type { AudioOutput } from "@harakiri/fidelity";
import { ServerUrl } from "@harakiri/jellyfin";
import { describe, expect, it } from "vitest";

import { playbackInfo } from "./fixtures/load";
import type { FixtureName } from "./fixtures/load";
import { startingFidelity } from "./playback";
import { resolve } from "./resolve";

const server = ServerUrl.parse("http://jf.test");

const receiver: AudioOutput = {
  kind: "known",
  name: "AV receiver",
  bitstream: ["ac3", "eac3", "dts", "dts-hd", "truehd"],
};

const usbInterface: AudioOutput = { kind: "known", name: "USB interface", bitstream: [] };

const viewOf = (
  fixture: FixtureName,
  itemId: string,
  output: AudioOutput,
  audioStreamIndex?: number
) =>
  fidelityView(
    startingFidelity(
      resolve(playbackInfo(fixture), { itemId, audioStreamIndex }, server),
      output,
      "colour-management"
    )
  );

const DV_TRUEHD = "fe56760a326f401c35863368589d15f1";

describe("fidelity input", () => {
  it("a direct play on a receiver states the file's own picture and the chosen track", () => {
    expect(viewOf("dv-hdr10-truehd-atmos", DV_TRUEHD, receiver, 3).facts).toStrictEqual([
      { text: "Dolby Vision mapped to HDR10", state: "mapped" },
      { text: "TrueHD Atmos bitstream", state: "native" },
    ]);
    expect(viewOf("dv-hdr10-truehd-atmos", DV_TRUEHD, receiver).facts[1]).toStrictEqual({
      text: "AC3 bitstream",
      state: "native",
    });
  });

  it("the same file on an analog output decodes the track and says why", () => {
    const view = viewOf("dv-hdr10-truehd-atmos", DV_TRUEHD, usbInterface, 3);
    expect(view.bitstream).toStrictEqual([]);
    expect(view.downgrades.map((d) => d.message)).toStrictEqual([
      "USB interface does not take TrueHD Atmos as a bitstream, so harakiri decodes it.",
    ]);
  });

  it("a transcode for bitrate encodes the picture to H.264 and copies the listed AAC track", () => {
    const view = viewOf("transcode-bitrate", "333d2fed9dc9bd770dfa6843547d111a", receiver);
    expect(view.facts).toStrictEqual([
      { text: "SDR", state: "native" },
      { text: "AAC decoded to PCM", state: "decoded" },
    ]);
    expect(view.downgrades).toStrictEqual([]);
  });

  it("a source the server never probed states no facts it cannot back", () => {
    const resolution = resolve(
      {
        PlaySessionId: "p",
        MediaSources: [
          {
            Id: "0123456789abcdef0123456789abcdef",
            MediaStreams: [],
            TranscodingUrl:
              "/videos/x/master.m3u8?VideoCodec=h264&AudioCodec=aac&TranscodeReasons=DirectPlayError",
          },
        ],
      },
      { itemId: "0123456789abcdef0123456789abcdef" },
      server
    );

    const view = fidelityView(startingFidelity(resolution, receiver, "colour-management"));
    expect([view.downgrades, view.facts]).toStrictEqual([
      [],
      [
        { text: "SDR", state: "native" },
        { text: "AAC decoded to PCM", state: "decoded" },
      ],
    ]);
  });
});
