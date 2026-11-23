import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Component } from "./licenses";
import { licenseGaps } from "./licenses";

let bundle = "";

const write = (rel: string, text = "x"): void => {
  const file = path.join(bundle, rel);

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

const upstream = {
  kind: "upstream",
  url: "https://example.org/mpv-1.0.tar.gz",
  sha256: "0".repeat(64),
} as const;

const MPV: Component = {
  name: "mpv",
  version: "1.0",
  license: "GPL-2.0-or-later",
  files: ["mpv"],
  source: upstream,
};

const COMPONENTS: readonly Component[] = [
  MPV,
  {
    name: "foo",
    version: "2.0-1.fc44",
    license: "MIT",
    files: ["lib/libfoo.so.1"],
    source: { kind: "srpm", srpm: "foo-2.0-1.fc44.src.rpm" },
  },
  { name: "foo-headers", version: "3.0", license: "MIT", files: [], source: upstream },
];

const writeManifest = (components: readonly Component[]): void => {
  write("manifest.json", JSON.stringify({ mpv: "1.0", components }));
};

/** mpv, lib/libfoo.so.1, the manifest naming COMPONENTS, and a license file for each */
const writeCompleteBundle = (): void => {
  write("mpv");
  write("lib/libfoo.so.1");
  writeManifest(COMPONENTS);
  write("licenses/README");
  write("licenses/COPYING.GPLv3");
  write("licenses/mpv/LICENSE.GPL");
  write("licenses/foo/COPYING");
  write("licenses/foo-headers/LICENSES/MIT.txt");
};

describe(licenseGaps, () => {
  beforeEach(() => {
    bundle = mkdtempSync(path.join(tmpdir(), "harakiri-licenses-"));
  });

  afterEach(() => {
    rmSync(bundle, { force: true, recursive: true });
  });

  it("finds none in a bundle whose every file has a component with a license", () => {
    writeCompleteBundle();
    expect(licenseGaps(bundle)).toStrictEqual([]);
  });

  it("names a file in lib/ that no component provides", () => {
    writeCompleteBundle();
    write("lib/libbar.so.2");
    expect(licenseGaps(bundle)).toStrictEqual(["lib/libbar.so.2: no component provides it"]);
  });

  it("names a component whose licenses/ dir is missing", () => {
    writeCompleteBundle();
    rmSync(path.join(bundle, "licenses/foo"), { recursive: true });
    expect(licenseGaps(bundle)).toStrictEqual(["foo: no license file in licenses/foo/"]);
  });

  it("names a component whose licenses/ dir holds no file", () => {
    writeCompleteBundle();
    rmSync(path.join(bundle, "licenses/foo-headers/LICENSES/MIT.txt"));
    expect(licenseGaps(bundle)).toStrictEqual([
      "foo-headers: no license file in licenses/foo-headers/",
    ]);
  });

  it("names a licenses/ dir that no component names", () => {
    writeCompleteBundle();
    write("licenses/bar/COPYING");
    expect(licenseGaps(bundle)).toStrictEqual(["licenses/bar/: no component named bar"]);
  });

  it.each(["README", "COPYING.GPLv3"])("names licenses/%s when it is missing", (name) => {
    writeCompleteBundle();
    rmSync(path.join(bundle, "licenses", name));
    expect(licenseGaps(bundle)).toStrictEqual([`licenses/${name}: missing`]);
  });

  it.each(["README", "COPYING.GPLv3"])("names licenses/%s when it is empty", (name) => {
    writeCompleteBundle();
    write(`licenses/${name}`, "");
    expect(licenseGaps(bundle)).toStrictEqual([`licenses/${name}: empty`]);
  });

  it("does not count an empty file as a component's license file", () => {
    writeCompleteBundle();
    write("licenses/foo/COPYING", "");
    expect(licenseGaps(bundle)).toStrictEqual(["foo: no license file in licenses/foo/"]);
  });

  it("names a component whose licenses/ entry is a file, not a directory", () => {
    writeCompleteBundle();
    rmSync(path.join(bundle, "licenses/foo"), { recursive: true });
    write("licenses/foo");
    expect(licenseGaps(bundle)).toStrictEqual([
      "foo: no license file in licenses/foo/",
      "licenses/foo: a file, not a directory",
    ]);
  });

  it("names a component name that two components have", () => {
    writeCompleteBundle();
    writeManifest([...COMPONENTS, { ...MPV, files: [] }]);
    expect(licenseGaps(bundle)).toStrictEqual(["mpv: the name of 2 components"]);
  });

  it("names a file that two components provide", () => {
    writeCompleteBundle();
    writeManifest(
      COMPONENTS.map((component) =>
        component.name === "foo-headers" ? { ...component, files: ["lib/libfoo.so.1"] } : component
      )
    );
    expect(licenseGaps(bundle)).toStrictEqual([
      "lib/libfoo.so.1: provided by 2 components, foo and foo-headers",
    ]);
  });

  it("rejects a manifest whose component names a path, not a directory", () => {
    writeCompleteBundle();
    writeManifest([{ ...MPV, name: "../mpv" }]);
    expect(() => licenseGaps(bundle)).toThrow(
      expect.objectContaining({
        issues: [expect.objectContaining({ path: ["components", 0, "name"] })],
      })
    );
  });
});
