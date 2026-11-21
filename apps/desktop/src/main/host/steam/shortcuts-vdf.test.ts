import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { configure, reset as resetLogging } from "@logtape/logtape";
import type { LogRecord } from "@logtape/logtape";
import { describe, expect, it } from "vitest";

import { encodeShortcuts } from "./fixtures/vdf";
import type { ShortcutEntry } from "./fixtures/vdf";
import { parseShortcuts, readShortcuts, shortcutFor } from "./shortcuts-vdf";

const entry: ShortcutEntry = { appId: 7, appName: "harakiri", exe: '"/data/h/steam/harakiri.sh"' };

const withByte = (bytes: Uint8Array, offset: number, value: number): Uint8Array => {
  const copy = Uint8Array.from(bytes);
  copy[offset] = value;

  return copy;
};

/** The offset of the first field's type byte: after `00 "shortcuts" 00 00 "0" 00`. */
const firstFieldTypeOffset = (bytes: Uint8Array): number =>
  Buffer.from(bytes).indexOf(Buffer.from("\u00000\0")) + 3;

const encodeRoot = (name: string): Uint8Array =>
  Buffer.concat([Buffer.from(`\0${name}\0`), Buffer.from([8, 8])]);

const recording = async (run: () => Promise<void>): Promise<LogRecord[]> => {
  const records: LogRecord[] = [];
  await configure({
    reset: true,
    sinks: {
      memory: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ["harakiri"], lowestLevel: "debug", sinks: ["memory"] },
      { category: ["logtape", "meta"], sinks: [] },
    ],
  });

  try {
    await run();
  } finally {
    await resetLogging();
  }

  return records;
};

describe(parseShortcuts, () => {
  it("reads Steam's casing and the unsigned app ID", () => {
    const bytes = encodeShortcuts([
      { appId: 3_141_592_653, appName: "harakiri", exe: '"/data/h/steam/harakiri.sh"' },
    ]);

    expect(parseShortcuts(bytes)).toStrictEqual([
      { appId: 3_141_592_653, appName: "harakiri", exe: '"/data/h/steam/harakiri.sh"' },
    ]);
  });

  it("a negative int32 app ID reads as its unsigned value", () => {
    expect(
      parseShortcuts(encodeShortcuts([{ appId: -1_153_374_643, appName: "a", exe: "/x" }]))[0]
        ?.appId
    ).toBe(3_141_592_653);
  });

  it("reads lower-case keys written by other tools", () => {
    const lower = { appId: 12_345, appName: "other", exe: "/x/y.sh", keys: "lower" } as const;
    expect(parseShortcuts(encodeShortcuts([lower]))).toStrictEqual([
      { appId: 12_345, appName: "other", exe: "/x/y.sh" },
    ]);
  });

  it("reads several entries in order", () => {
    const found = parseShortcuts(
      encodeShortcuts([entry, { appId: 9, appName: "two", exe: "/two" }])
    );

    expect(found.map((shortcut) => shortcut.appName)).toStrictEqual(["harakiri", "two"]);
  });

  it("an empty file and a file with no entries have no shortcuts", () => {
    expect(parseShortcuts(new Uint8Array())).toStrictEqual([]);
    expect(parseShortcuts(encodeShortcuts([]))).toStrictEqual([]);
  });

  it.each([
    ["truncated mid-entry", (b: Uint8Array) => b.subarray(0, -20)],
    ["an unknown type byte", (b: Uint8Array) => withByte(b, firstFieldTypeOffset(b), 0x07)],
    ["a different root", () => encodeRoot("screenshots")],
  ])("%s throws VdfError", (_name, mangle) => {
    expect(() => parseShortcuts(mangle(encodeShortcuts([entry])))).toThrow(
      expect.objectContaining({ name: "VdfError" })
    );
  });
});

describe(readShortcuts, () => {
  it("a missing file is [], a broken one is [] and one warning", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harakiri-vdf-"));

    try {
      const broken = path.join(dir, "shortcuts.vdf");
      await writeFile(broken, encodeShortcuts([entry]).subarray(0, 30));
      const good = path.join(dir, "good.vdf");
      await writeFile(good, encodeShortcuts([entry]));

      const records = await recording(async () => {
        await expect(readShortcuts(path.join(dir, "missing.vdf"))).resolves.toStrictEqual([]);
        await expect(readShortcuts(broken)).resolves.toStrictEqual([]);
        await expect(readShortcuts(good)).resolves.toHaveLength(1);
      });

      const warnings = records.filter((record) => record.level === "warning");
      expect(warnings).toHaveLength(1);
      expect(JSON.stringify(warnings[0]?.properties) + String(warnings[0]?.message)).toContain(
        broken
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("other IO errors reject", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "harakiri-vdf-"));

    try {
      await expect(readShortcuts(dir)).rejects.toThrow(/EISDIR/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe(shortcutFor, () => {
  it.each([
    ['"/data/h/steam/harakiri.sh"', true],
    ["/data/h/steam/harakiri.sh", true],
    ['"/data/h/steam/harakiri.sh" --flag', false],
    ['"/data/other/harakiri.sh"', false],
  ])("matches Exe %s: %s", (exe, matches) => {
    const shortcut = { appId: 1, appName: "harakiri", exe };
    expect(shortcutFor([shortcut], "/data/h/steam/harakiri.sh")).toStrictEqual(
      matches ? shortcut : undefined
    );
  });
});
