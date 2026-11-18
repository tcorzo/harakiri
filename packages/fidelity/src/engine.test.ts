import { describe, expect, test } from "vitest";

import { fidelityView, observe, startFidelity } from "./engine";
import type { FidelityStart } from "./engine";
import type { AudioOutput, Observation, PictureSource, SoundSource } from "./model";

const dvP5: PictureSource = { range: "Dolby Vision", label: "Dolby Vision" };
const hdr10: PictureSource = { range: "HDR10", label: "HDR10" };
const sdr: PictureSource = { range: "SDR", label: "SDR" };
const eac3: SoundSource = { carriage: "eac3", label: "E-AC3 5.1" };
const dtsHd: SoundSource = { carriage: "dts-hd", label: "DTS-HD MA 7.1" };
const dts: SoundSource = { carriage: "dts", label: "DTS 5.1" };
const flac: SoundSource = { carriage: "decode", label: "FLAC 2.0" };

const usbInterface: AudioOutput = { kind: "known", name: "USB interface", bitstream: [] };

const receiver: AudioOutput = {
  kind: "known",
  name: "AV receiver",
  bitstream: ["ac3", "eac3", "dts", "dts-hd", "truehd"],
};

const start = (overrides: Partial<FidelityStart> = {}) =>
  startFidelity({
    picture: dvP5,
    sound: eac3,
    delivery: { kind: "direct" },
    output: receiver,
    ...overrides,
  });

function run(initial: ReturnType<typeof startFidelity>, ...observations: Observation[]) {
  let state = initial;
  const actions = [];

  for (const observation of observations) {
    const step = observe(state, observation);
    state = step.state;
    actions.push(...step.actions);
  }

  return { view: fidelityView(state), actions };
}

describe("sound", () => {
  test("a receiver that takes the codec gets the bitstream, and nothing is downgraded", () => {
    const view = fidelityView(start());
    expect(view.bitstream).toEqual(["ac3", "eac3", "dts", "dts-hd", "truehd"]);
    expect(view.facts).toEqual([
      { text: "Dolby Vision mapped to HDR10", state: "mapped" },
      { text: "E-AC3 5.1 bitstream", state: "native" },
    ]);
    expect(view.downgrades).toEqual([]);
  });

  test("an analog output that takes only PCM decodes the track, and says why", () => {
    const view = fidelityView(start({ output: usbInterface }));
    expect(view.bitstream).toEqual([]);
    expect(view.facts[1]).toEqual({ text: "E-AC3 5.1 decoded to PCM", state: "decoded" });
    expect(view.downgrades).toEqual([
      {
        leg: "sound",
        from: "E-AC3 5.1 bitstream",
        to: "E-AC3 5.1 decoded to PCM",
        reason: { kind: "outputRefuses", output: "USB interface" },
        message: "USB interface does not take E-AC3 5.1 as a bitstream, so harakiri decodes it.",
      },
    ]);
  });

  test("an output that cannot be read decodes rather than risk a silent bitstream", () => {
    const view = fidelityView(start({ output: { kind: "unknown", detail: "pactl not found" } }));
    expect(view.bitstream).toEqual([]);
    expect(view.downgrades.map((d) => d.reason)).toEqual([
      { kind: "outputUnknown", detail: "pactl not found" },
    ]);
  });

  test("a DTS-HD track on an output with plain DTS only is decoded, never cut to the lossy core", () => {
    const oldReceiver: AudioOutput = { kind: "known", name: "Old AVR", bitstream: ["ac3", "dts"] };
    expect(fidelityView(start({ sound: dtsHd, output: oldReceiver })).bitstream).toEqual(["ac3"]);
    expect(fidelityView(start({ sound: dts, output: oldReceiver })).bitstream).toEqual([
      "ac3",
      "dts",
    ]);
  });

  test("a format that cannot be bitstreamed is decoded on any output and is no downgrade", () => {
    const view = fidelityView(start({ sound: flac }));
    expect(view.facts[1]).toEqual({ text: "FLAC 2.0 decoded to PCM", state: "decoded" });
    expect(view.downgrades).toEqual([]);
  });

  test("a bitstream the output stops taking steps down to decoding, then to no sound", () => {
    const failed = run(start(), { kind: "audioOutputFailed" });
    expect(failed.actions).toEqual([{ kind: "setBitstream", codecs: [] }]);
    expect(failed.view.facts[1]).toEqual({ text: "E-AC3 5.1 decoded to PCM", state: "decoded" });
    expect(failed.view.downgrades[0]?.message).toBe(
      "AV receiver stopped taking the E-AC3 5.1 bitstream, so harakiri decodes it."
    );

    const silent = run(start(), { kind: "audioOutputFailed" }, { kind: "audioOutputFailed" });
    expect(silent.view.facts[1]).toEqual({ text: "No sound", state: "decoded" });
    expect(silent.view.downgrades[0]?.message).toBe(
      "AV receiver stopped playing sound. The picture carries on without it."
    );
  });

  test("after the output broke, a newly chosen track is decoded too", () => {
    const { view, actions } = run(
      start(),
      { kind: "audioOutputFailed" },
      { kind: "soundTrack", sound: dtsHd }
    );

    expect(actions).toEqual([{ kind: "setBitstream", codecs: [] }]);
    expect(view.facts[1]).toEqual({ text: "DTS-HD MA 7.1 decoded to PCM", state: "decoded" });
  });
});

describe("picture", () => {
  test("an HDR display shows HDR10 as it is", () => {
    expect(fidelityView(start({ picture: hdr10 })).facts[0]).toEqual({
      text: "HDR10",
      state: "native",
    });
    const shown = run(start({ picture: hdr10 }), { kind: "displayTarget", hdr: true });
    expect(shown.view.downgrades).toEqual([]);
  });

  test("an SDR display tone-maps HDR, and says why", () => {
    const { view } = run(start(), { kind: "displayTarget", hdr: false });
    expect(view.facts[0]).toEqual({ text: "Dolby Vision tone-mapped to SDR", state: "mapped" });
    expect(view.downgrades).toEqual([
      {
        leg: "picture",
        from: "Dolby Vision mapped to HDR10",
        to: "Dolby Vision tone-mapped to SDR",
        reason: { kind: "displaySdr" },
        message: "The display takes SDR only, so Dolby Vision is tone-mapped to SDR.",
      },
    ]);
  });

  test("a failed Vulkan steps down to OpenGL, then legacy OpenGL, then no picture", () => {
    const once = run(start(), { kind: "rendererFailed" });
    expect(once.actions).toEqual([{ kind: "setRenderer", renderer: "opengl" }]);
    expect(once.view.downgrades[0]?.message).toBe(
      "Vulkan could not start, so harakiri renders with OpenGL, which cannot send HDR. Dolby Vision is tone-mapped to SDR."
    );

    const all = run(
      start(),
      { kind: "rendererFailed" },
      { kind: "rendererFailed" },
      { kind: "rendererFailed" }
    );

    expect(all.actions).toEqual([
      { kind: "setRenderer", renderer: "opengl" },
      { kind: "setRenderer", renderer: "opengl-legacy" },
    ]);
    expect(all.view.renderer).toBe("none");
    expect(all.view.facts[0]).toEqual({ text: "No picture", state: "mapped" });
  });

  test("an SDR picture loses nothing on OpenGL", () => {
    const { view } = run(start({ picture: sdr }), { kind: "rendererFailed" });
    expect(view.facts[0]).toEqual({ text: "SDR", state: "native" });
    expect(view.downgrades).toEqual([]);
  });
});

describe("delivery", () => {
  test("a server transcode is reported leg by leg with the server's reasons", () => {
    const view = fidelityView(
      start({
        delivery: {
          kind: "transcode",
          reasons: ["HDR format not supported"],
          picture: sdr,
          sound: { carriage: "decode", label: "AAC 5.1" },
        },
      })
    );

    expect(view.facts).toEqual([
      { text: "SDR", state: "native" },
      { text: "AAC 5.1 decoded to PCM", state: "decoded" },
    ]);
    expect(view.downgrades.map((d) => d.message)).toEqual([
      "The server converts Dolby Vision to SDR (HDR format not supported).",
      "The server converts E-AC3 5.1 to AAC 5.1 (HDR format not supported).",
    ]);
  });
});
