import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { expectShortByAtMostOneMatFrame } from "./assertions";
import { muxSpdif, remuxToMatroska, sha256 } from "./clips";
import { elementaryStream, scanBursts } from "./iec61937";
import { captureWithMpv } from "./mpv-capture";
import { readPcm16 } from "./wav";

/**
 * FFmpeg FATE samples (fate-suite.ffmpeg.org: dts/master_audio_7.1_24bit.dts,
 * dts/dtsx_7.1.4_24bit.dts, truehd/atmos.thd) cover what FFmpeg cannot encode: DTS-HD MA,
 * DTS:X and TrueHD Atmos. Their redistribution licence is unverified, so they are not
 * vendored. This is the FATE tier (`mise run test:fate`): it fails, never skips, when
 * HARAKIRI_FATE_DIR is unset or lacks a sample.
 */
const fateDir = process.env["HARAKIRI_FATE_DIR"];
const SAMPLES = ["master_audio_7.1_24bit.dts", "dtsx_7.1.4_24bit.dts", "atmos.thd"];
const FETCH = "run `mise run media:fetch-fate` and export HARAKIRI_FATE_DIR to its directory";

if (fateDir === undefined || fateDir === "") {
  throw new Error(`HARAKIRI_FATE_DIR is unset: ${FETCH} (needs ${SAMPLES.join(", ")})`);
}

const missing = SAMPLES.filter((name) => !existsSync(join(fateDir, name)));

if (missing.length > 0) {
  throw new Error(`HARAKIRI_FATE_DIR=${fateDir} lacks ${missing.join(", ")}: ${FETCH}`);
}

describe("FATE: HBR streams through the extractor and mpv", () => {
  let dir: string;
  const sample = (name: string) => join(fateDir, name);

  const spdif = (input: string, out: string, options: { dtshdRate?: number } = {}) => {
    muxSpdif(input, join(dir, out), options);

    return readPcm16(readFileSync(join(dir, out))).data;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "harness-fate-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test.each(["master_audio_7.1_24bit.dts", "dtsx_7.1.4_24bit.dts"])(
    "%s at dtshd_rate 768000 round-trips byte for byte in type IV bursts",
    (name) => {
      const bursts = scanBursts(spdif(sample(name), `${name}.spdif`, { dtshdRate: 768_000 }));
      expect([...new Set(bursts.map((b) => `${b.dataType}/${b.subtype}`))]).toEqual(["17/4"]);
      expect(sha256(elementaryStream(bursts).bytes)).toBe(sha256(readFileSync(sample(name))));
    }
  );

  test("DTS-HD MA sent as core only (mpv's plain `dts` token) is caught", () => {
    const source = readFileSync(sample("master_audio_7.1_24bit.dts"));

    const extracted = elementaryStream(
      scanBursts(spdif(sample("master_audio_7.1_24bit.dts"), "ma-core.spdif"))
    );

    expect(extracted.codec).toBe("dts");
    expect(extracted.bytes.length).toBeLessThan(source.length);
    expect(sha256(extracted.bytes)).not.toBe(sha256(source));
  });

  test("TrueHD Atmos yields a prefix of the source, short by the unflushed last MAT frame", () => {
    const source = readFileSync(sample("atmos.thd"));
    const extracted = elementaryStream(scanBursts(spdif(sample("atmos.thd"), "atmos.spdif")));
    expect(extracted).toMatchObject({ codec: "truehd", partialTailBytes: 0 });
    expectShortByAtMostOneMatFrame(extracted.bytes, source);
  });

  test.each([
    { name: "master_audio_7.1_24bit.dts", dtshdRate: 768_000, format: "spdif-dtshd" },
    { name: "atmos.thd", dtshdRate: undefined, format: "spdif-truehd" },
  ])(
    "mpv capture of $name equals FFmpeg's spdif output byte for byte",
    ({ name, dtshdRate, format }) => {
      const mkv = join(dir, `${name}.mkv`);
      remuxToMatroska(sample(name), mkv);
      const wav = join(dir, `${name}.wav`);
      const ao = captureWithMpv(mkv, wav);
      expect(ao).toEqual({ sampleRate: 192000, channels: 8, format });

      const reference = spdif(
        mkv,
        `${name}.mkv.spdif`,
        dtshdRate === undefined ? {} : { dtshdRate }
      );

      expect(sha256(readPcm16(readFileSync(wav)).data)).toBe(sha256(reference));
    }
  );
});
