import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { exportedSymbols, neededLibs } from "./elf";

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

/** The names of the regular files in the bundle's lib/. */
const bundledLibs = (bundleDir: string): string[] => {
  const libDir = path.join(bundleDir, "lib");

  return existsSync(libDir)
    ? readdirSync(libDir).filter((name) => isRegularFile(path.join(libDir, name)))
    : [];
};

/** `mpv`, then `lib/<name>` for each regular file in the bundle's lib/. */
const bundleFiles = (bundleDir: string): string[] => [
  "mpv",
  ...bundledLibs(bundleDir).map((name) => `lib/${name}`),
];

/** `<path relative to bundleDir>: <soname>` for each need of `mpv` and of every file in `lib/` that is neither a file in lib/ nor a host lib. */
export const unbundledNeeds = (bundleDir: string, patterns: readonly string[]): string[] => {
  const bundled = new Set(bundledLibs(bundleDir));

  return bundleFiles(bundleDir).flatMap((rel) =>
    neededLibs(path.join(bundleDir, rel))
      .filter((soname) => !bundled.has(soname) && !isHostLib(soname, patterns))
      .map((soname) => `${rel}: ${soname}`)
  );
};

// shaderc, glslang and SPIRV-Tools: their C APIs (glslang has two, glslang_* and the older Sh*),
// and the C++ namespaces and free functions a mangled name spells.
const SHADER_COMPILER_C_API = /^(?:shaderc_|glslang_|spv[A-Z_]|Sh[A-Z][a-z])/u;

const SHADER_COMPILER_CXX_NAME =
  /^(?:glslang|shaderc|shaderc_util|spv|spvtools|spvutils)$|^spv[A-Z_]|^shaderc_/u;

/**
 * Each `<length><identifier>` source name an Itanium-mangled name may hold. It reads one at every
 * run of digits, so it also yields fragments that are not names; none of them matches a name here.
 */
const sourceNames = (mangled: string): string[] =>
  [...mangled.matchAll(/\d+/gu)].map((match) => {
    const start = match.index + match[0].length;

    return mangled.slice(start, start + Number(match[0]));
  });

/** Whether a symbol is shaderc's, glslang's or SPIRV-Tools', or a std template over their types. */
export const isShaderCompilerSymbol = (name: string): boolean =>
  name.startsWith("_Z")
    ? sourceNames(name).some((source) => SHADER_COMPILER_CXX_NAME.test(source))
    : SHADER_COMPILER_C_API.test(name);

/** `<path relative to bundleDir>: <symbol>` for each shaderc, glslang or SPIRV-Tools symbol that `mpv` or a file in `lib/` exports. */
export const shaderCompilerExports = (bundleDir: string): string[] =>
  bundleFiles(bundleDir).flatMap((rel) =>
    exportedSymbols(path.join(bundleDir, rel))
      .filter((symbol) => isShaderCompilerSymbol(symbol))
      .map((symbol) => `${rel}: ${symbol}`)
  );
