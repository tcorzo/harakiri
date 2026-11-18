/// <reference types="node" />
import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { classifyFidelity } from "./fidelity";
import { zMediaSourceInfo } from "./generated/zod.gen";

const Fixture = zMediaSourceInfo.pick({
  Id: true,
  Container: true,
  DefaultAudioStreamIndex: true,
  MediaStreams: true,
});
const fixture = (name: string) =>
  Fixture.parse(
    JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), "utf8"))
  );

const dovInvalidSdrAac = fixture("dovi-invalid-sdr-aac");
const dv5Eac3 = fixture("dv5-eac3");
const dv7FelTruehd = fixture("dv7-fel-truehd");
const dv8Ac3 = fixture("dv8-1080p-ac3");
const dv8Hdr10PlusTruehdAtmos = fixture("dv8-hdr10plus-truehd-atmos");
const dv8Mp4Eac3 = fixture("dv8-mp4-eac3");
const hdr10DualLayer = fixture("hdr10-dual-layer-m2ts");
const hdr10TruehdAtmos = fixture("hdr10-truehd-atmos");
const hdr10PlusDtsHdMa = fixture("hdr10plus-dtshd-ma");
const sdr4kDts = fixture("sdr-4k-dts");
const sdr4kEac3 = fixture("sdr-4k-eac3");
const sdrAv1Opus = fixture("sdr-av1-opus");
const sdrDtsx = fixture("sdr-dtsx-m2ts");
const sdrEac3Atmos = fixture("sdr-eac3-atmos");
const sdrHi10pFlac = fixture("sdr-hi10p-flac");
const sdrMpegtsAac = fixture("sdr-mpegts-aac");
const sdrPcmMono = fixture("sdr-pcm-mono");
const sdrVc1Truehd = fixture("sdr-vc1-truehd");

describe("programme notes and signal path for every census fixture class (real dev-server MediaSources)", () => {
  test.each([
    [
      dv8Hdr10PlusTruehdAtmos,
      "4K Dolby Vision · TrueHD Atmos 7.1",
      "Dolby Vision mapped to HDR10 · TrueHD Atmos bitstream",
    ],
    [
      dv7FelTruehd,
      "4K Dolby Vision (base layer) · TrueHD 5.1",
      "Dolby Vision base layer mapped to HDR10 · TrueHD bitstream",
    ],
    [dv5Eac3, "4K Dolby Vision · E-AC3 5.1", "Dolby Vision mapped to HDR10 · E-AC3 bitstream"],
    [dv8Mp4Eac3, "4K Dolby Vision · E-AC3 5.1", "Dolby Vision mapped to HDR10 · E-AC3 bitstream"],
    [dv8Ac3, "1080p Dolby Vision · AC3 5.1", "Dolby Vision mapped to HDR10 · AC3 bitstream"],
    [dovInvalidSdrAac, "4K SDR · AAC 5.1", "SDR · AAC decoded to PCM"],
    [hdr10TruehdAtmos, "4K HDR10 · TrueHD Atmos 7.1", "HDR10 · TrueHD Atmos bitstream"],
    [hdr10PlusDtsHdMa, "4K HDR10+ · DTS-HD MA 5.1", "HDR10+ · DTS-HD MA bitstream"],
    [hdr10DualLayer, "4K HDR10 · DTS-HD MA 2.0", "HDR10 · DTS-HD MA bitstream"],
    [sdrDtsx, "1080p SDR · DTS:X 7.1", "SDR · DTS:X bitstream"],
    [sdr4kEac3, "4K SDR · E-AC3 5.1", "SDR · E-AC3 bitstream"],
    [sdrAv1Opus, "1080p SDR · Opus 2.0", "SDR · Opus decoded to PCM"],
    [sdrHi10pFlac, "1080p SDR · FLAC 2.0", "SDR · FLAC decoded to PCM"],
    [sdrVc1Truehd, "1080p SDR · TrueHD 5.1", "SDR · TrueHD bitstream"],
    [sdr4kDts, "4K SDR · DTS 5.1", "SDR · DTS bitstream"],
    [sdrPcmMono, "1080p SDR · PCM 1.0", "SDR · PCM"],
    [sdrMpegtsAac, "1080p SDR · AAC 2.0", "SDR · AAC decoded to PCM"],
    [sdrEac3Atmos, "1080p SDR · E-AC3 Atmos 5.1", "SDR · E-AC3 Atmos bitstream"],
  ])("%#: %s", (json, notes, signalPath) => {
    const fidelity = classifyFidelity(json);
    expect(fidelity?.notes).toBe(notes);
    expect(fidelity?.signalPath).toBe(signalPath);
  });
});

test("DV 8.1 with HDR10 base and HDR10+ is mapped; TrueHD Atmos 7.1 beats E-AC3 Atmos and 7.1 PCM", () => {
  expect(classifyFidelity(dv8Hdr10PlusTruehdAtmos)).toEqual({
    picture: {
      range: "Dolby Vision",
      resolution: "4K",
      delivery: "mapped",
      profile: 8,
      compatibility: "HDR10",
      hdr10Plus: true,
      playback: "complete",
    },
    sound: {
      format: "TrueHD Atmos",
      codec: "truehd",
      channels: "7.1",
      delivery: "native",
      streamIndex: 3,
    },
    signal: [
      { text: "Dolby Vision mapped to HDR10", state: "mapped" },
      { text: "TrueHD Atmos bitstream", state: "native" },
    ],
    notes: "4K Dolby Vision · TrueHD Atmos 7.1",
    signalPath: "Dolby Vision mapped to HDR10 · TrueHD Atmos bitstream",
  });
});

test("DV 7 with an enhancement layer plays the base layer only", () => {
  expect(classifyFidelity(dv7FelTruehd)?.picture).toEqual({
    range: "Dolby Vision",
    resolution: "4K",
    delivery: "mapped",
    profile: 7,
    compatibility: "HDR10",
    hdr10Plus: false,
    playback: "base-layer-only",
  });
});

test("DV 5 has no fallback layer", () => {
  expect(classifyFidelity(dv5Eac3)?.picture).toMatchObject({ profile: 5, compatibility: "none" });
});

test("a stale DOVI record on an SDR stream stays SDR", () => {
  expect(classifyFidelity(dovInvalidSdrAac)?.picture).toEqual({
    range: "SDR",
    resolution: "4K",
    delivery: "native",
  });
});

test("an explicit audio track describes that track: a default Russian AC3 stereo", () => {
  const fidelity = classifyFidelity(hdr10TruehdAtmos, { audioStreamIndex: 4 });
  expect(fidelity?.notes).toBe("4K HDR10 · AC3 2.0");
  expect(fidelity?.sound).toEqual({
    format: "AC3",
    codec: "ac3",
    channels: "2.0",
    delivery: "native",
    streamIndex: 4,
  });
});

test("an E-AC3 Atmos track keeps the server's 5.1.2 layout", () => {
  expect(classifyFidelity(dv8Hdr10PlusTruehdAtmos, { audioStreamIndex: 4 })?.notes).toBe(
    "4K Dolby Vision · E-AC3 Atmos 5.1.2"
  );
});

test("a file the server has not probed yet has no fidelity", () => {
  expect(classifyFidelity({ Container: "mkv", MediaStreams: [] })).toBeNull();
  expect(classifyFidelity(undefined)).toBeNull();
});

test("HLG is mapped to HDR10, and a video without audio has no sound note", () => {
  expect(
    classifyFidelity({
      MediaStreams: [
        {
          Type: "Video",
          Index: 0,
          Width: 1280,
          Height: 720,
          VideoRange: "HDR",
          VideoRangeType: "HLG",
        },
      ],
    })
  ).toEqual({
    picture: { range: "HLG", resolution: "720p", delivery: "mapped" },
    sound: null,
    signal: [{ text: "HLG mapped to HDR10", state: "mapped" }],
    notes: "720p HLG",
    signalPath: "HLG mapped to HDR10",
  });
});

test("an audio codec outside the classes is named by its codec and decoded", () => {
  expect(
    classifyFidelity({
      MediaStreams: [
        {
          Type: "Video",
          Index: 0,
          Width: 720,
          Height: 480,
          VideoRange: "SDR",
          VideoRangeType: "SDR",
        },
        { Type: "Audio", Index: 1, Codec: "mp3", Channels: 2 },
      ],
    })?.signalPath
  ).toBe("SDR · MP3 decoded to PCM");
});
