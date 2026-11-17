import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { FateSample } from "./catalog";

/**
 * FFmpeg FATE samples for what FFmpeg cannot encode: TrueHD Atmos, E-AC3 JOC, DTS-HD MA, DTS:X,
 * VC-1 and Dolby Vision profile 7. fate-suite.ffmpeg.org states no licence, so they are fetched
 * at setup and pinned by sha256, never vendored. 8.1 MB in all.
 *
 * Files land flat (by basename) in the FATE dir, the layout HARAKIRI_FATE_DIR suites expect.
 */
export const FATE_SAMPLES: Readonly<Record<FateSample, { path: string; sha256: string }>> = {
  "atmos.thd": {
    path: "truehd/atmos.thd",
    sha256: "020c9b9e67f80de105663af191740f8b60f550107c9f765b632f4cd5efb1c6ab",
  },
  "the_great_wall_7.1.eac3": {
    path: "eac3/the_great_wall_7.1.eac3",
    sha256: "d698981ddc1c10e65d234dd6a02ff2b0f4c88787595c9d3e5adf7f097f2c9e50",
  },
  "master_audio_7.1_24bit.dts": {
    path: "dts/master_audio_7.1_24bit.dts",
    sha256: "227f1008f9529b2bdf937ce856d2562d0128162ac930e2579ef4b8fd7474ee18",
  },
  "dtsx_7.1.4_24bit.dts": {
    path: "dts/dtsx_7.1.4_24bit.dts",
    sha256: "f3b5ac8a758fbf341805d00878a91507c4c663f9466a1bb56a5a3a93813da517",
  },
  "SA00040.vc1": {
    path: "vc1/SA00040.vc1",
    sha256: "898035e63cfe0ddb1cc2c8749d7dafdfcc1b12fe5dac7e5b65941e6c4e41c860",
  },
  "dovi-p7-hvce.mkv": {
    path: "mkv/dovi-p7-hvce.mkv",
    sha256: "3287bac8deade11e1c57bd65b9c7c8750a1e38e286666cbb4fa39eac264875df",
  },
};

export const DEFAULT_FATE_MIRROR = "https://fate-suite.ffmpeg.org";

const SAMPLE_NAMES: readonly FateSample[] = [
  "atmos.thd",
  "the_great_wall_7.1.eac3",
  "master_audio_7.1_24bit.dts",
  "dtsx_7.1.4_24bit.dts",
  "SA00040.vc1",
  "dovi-p7-hvce.mkv",
];

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

export type FateState =
  | { readonly kind: "complete" }
  | { readonly kind: "absent" }
  | { readonly kind: "partial"; readonly missing: readonly FateSample[] }
  | { readonly kind: "corrupt"; readonly bad: readonly FateSample[] };

/** Checks every pinned sample in `dir`. A file with the wrong hash is never used. */
export const fateState = (dir: string): FateState => {
  const missing = SAMPLE_NAMES.filter((name) => !existsSync(join(dir, name)));

  const bad = SAMPLE_NAMES.filter(
    (name) =>
      !missing.includes(name) && sha256(readFileSync(join(dir, name))) !== FATE_SAMPLES[name].sha256
  );

  if (bad.length > 0) {
    return { kind: "corrupt", bad };
  }

  if (missing.length === SAMPLE_NAMES.length) {
    return { kind: "absent" };
  }

  if (missing.length > 0) {
    return { kind: "partial", missing };
  }

  return { kind: "complete" };
};

/**
 * Downloads every sample that is missing or wrong, then verifies it. Throws on the first sample
 * that cannot be fetched or does not match its pin: a failed fetch is never a silent skip.
 */
export const fetchFate = async (
  dir: string,
  mirror: string,
  log: (line: string) => void
): Promise<void> => {
  mkdirSync(dir, { recursive: true });
  const base = mirror.replace(/\/+$/, "");
  const failures: string[] = [];

  for (const name of SAMPLE_NAMES) {
    const { path, sha256: want } = FATE_SAMPLES[name];
    const file = join(dir, name);

    if (existsSync(file) && sha256(readFileSync(file)) === want) {
      log(`${name}: present, sha256 ok`);
      continue;
    }

    const url = `${base}/${path}`;

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = new Uint8Array(await response.arrayBuffer());
      const got = sha256(data);

      if (got !== want) {
        throw new Error(`sha256 ${got}, pinned ${want}`);
      }

      writeFileSync(`${file}.part`, data);
      renameSync(`${file}.part`, file);
      log(`${name}: fetched ${data.length} bytes, sha256 ok`);
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `FATE fetch failed for ${failures.length} of ${SAMPLE_NAMES.length} samples ` +
        `(set HARAKIRI_FATE_MIRROR to use a mirror):\n  ${failures.join("\n  ")}`
    );
  }
};
