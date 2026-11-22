import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { neededLibs } from "./elf";

/** mpv/host-libs.txt: one soname pattern per line; `*` is the only wildcard; `#` starts a comment. */
export const readHostLibs = (recipeDir: string): string[] =>
  readFileSync(path.join(recipeDir, "host-libs.txt"), "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

const escapeRegExp = (text: string): string =>
  text.replaceAll(/[$()+.?[\\\]^{|}]/gu, String.raw`\$&`);

const patternToRegExp = (pattern: string): RegExp =>
  new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`, "u");

export const isHostLib = (soname: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => patternToRegExp(pattern).test(soname));

const isRegularFile = (file: string): boolean => statSync(file).isFile();

/** `<path relative to bundleDir>: <soname>` for each need of `mpv` and of every file in `lib/` that is neither a file in lib/ nor a host lib. */
export const unbundledNeeds = (bundleDir: string, patterns: readonly string[]): string[] => {
  const libDir = path.join(bundleDir, "lib");

  const libs = existsSync(libDir)
    ? readdirSync(libDir).filter((name) => isRegularFile(path.join(libDir, name)))
    : [];

  const bundled = new Set(libs);
  const files = ["mpv", ...libs.map((name) => `lib/${name}`)];

  return files.flatMap((rel) =>
    neededLibs(path.join(bundleDir, rel))
      .filter((soname) => !bundled.has(soname) && !isHostLib(soname, patterns))
      .map((soname) => `${rel}: ${soname}`)
  );
};
