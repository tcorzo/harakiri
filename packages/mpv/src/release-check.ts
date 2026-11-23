import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { repoRootFrom } from "./bundle";
import { readHostLibs, unbundledNeeds } from "./host-libs";
import { licenseGaps } from "./licenses";

export interface MpvBundleCheck {
  readonly name: string;
  /** One line per problem; empty when the check passes. */
  readonly problems: readonly string[];
}

const ManifestVersion = z.object({ mpv: z.string() });

interface Tree {
  /** The regular files, as `/`-separated paths relative to the tree's root, sorted. */
  readonly files: string[];
  /** Each entry that is neither a directory nor a regular file (a symlink, say), as `<rel>: not a regular file`. */
  readonly problems: string[];
}

const relativeTo = (dir: string, entry: { parentPath: string; name: string }): string =>
  path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/");

/** The regular files under dir. A symlink is never followed: it is a problem, not a file. */
const treeOf = (dir: string): Tree => {
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true }).filter(
    (entry) => !entry.isDirectory()
  );

  return {
    files: entries
      .flatMap((entry) => (entry.isFile() ? [relativeTo(dir, entry)] : []))
      .toSorted((a, b) => (a < b ? -1 : Number(a > b))),
    problems: entries.flatMap((entry) =>
      entry.isFile() ? [] : [`${relativeTo(dir, entry)}: not a regular file`]
    ),
  };
};

const sha256 = (file: string): string =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

/**
 * The first file of `built` that `shipped` lacks or holds other bytes of, the first file only
 * `shipped` has, and every entry of either tree that is not a regular file.
 */
const sameFiles = (shipped: string, built: string): string[] => {
  const shippedTree = treeOf(shipped);
  const builtTree = treeOf(built);
  const shippedFiles = new Set(shippedTree.files);
  const builtFiles = new Set(builtTree.files);

  const differs = builtTree.files.find(
    (rel) =>
      !shippedFiles.has(rel) || sha256(path.join(shipped, rel)) !== sha256(path.join(built, rel))
  );

  const extra = shippedTree.files.find((rel) => !builtFiles.has(rel));

  return [
    ...(differs === undefined ? [] : [`${differs}: differs from the recipe's build`]),
    ...(extra === undefined ? [] : [`${extra}: not in the recipe's build`]),
    ...shippedTree.problems,
    ...builtTree.problems.map((problem) => `the recipe's build: ${problem}`),
  ];
};

type Run = { ok: true; output: string } | { ok: false; problem: string };

/** `env -i <shipped>/mpv --no-config <args>`: no inherited library path, no config. */
const runMpv = (shipped: string, args: readonly string[]): Run => {
  try {
    return {
      ok: true,
      output: execFileSync(path.join(shipped, "mpv"), ["--no-config", ...args], {
        encoding: "utf-8",
        env: {},
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    const why = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);

    return { ok: false, problem: `mpv ${args.join(" ")} failed: ${why}` };
  }
};

/** `[]` when the run succeeded and its output `holds`, else the one problem. */
const problemOf = (run: Run, holds: (output: string) => boolean, problem: string): string[] => {
  if (!run.ok) {
    return [run.problem];
  }

  return holds(run.output) ? [] : [problem];
};

/** Each of `names` that no line of `mpv <args>`'s output starts with, as `<args> lists no <name>`. */
const lists = (shipped: string, args: readonly string[], names: readonly string[]): string[] => {
  const run = runMpv(shipped, args);

  if (!run.ok) {
    return [run.problem];
  }

  return names.flatMap((name) =>
    new RegExp(`^\\s*${name}\\s`, "mu").test(run.output)
      ? []
      : [`${args.join(" ")} lists no ${name}`]
  );
};

const escapeRegExp = (text: string): string => text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, "\\$&");

/** mpv --version prints the built manifest's mpv version, and -v names SDL2 gamepad input. */
const runs = (shipped: string, built: string): string[] => {
  const { mpv } = ManifestVersion.parse(
    JSON.parse(readFileSync(path.join(built, "manifest.json"), "utf-8"))
  );

  return [
    ...problemOf(
      runMpv(shipped, ["--version"]),
      (output) => new RegExp(`^mpv v${escapeRegExp(mpv)} `, "mu").test(output),
      `--version does not print mpv v${mpv}`
    ),
    ...problemOf(
      runMpv(shipped, ["-v", "--version"]),
      (output) =>
        (/Configuration: (?<flags>.*)$/mu.exec(output)?.groups?.flags ?? "").includes(
          "-Dsdl2-gamepad=enabled"
        ),
      "-v --version does not name -Dsdl2-gamepad=enabled"
    ),
  ];
};

/** The check's problems; a check that throws (a file it reads is missing, say) fails with the error. */
const guarded = (name: string, problems: () => readonly string[]): MpvBundleCheck => {
  try {
    return { name, problems: problems() };
  } catch (error) {
    return { name, problems: [error instanceof Error ? error.message : String(error)] };
  }
};

/**
 * The checks on the mpv bundle an AppImage ships in `resources/mpv/` (`shipped`), against the
 * recipe's build in `.cache/mpv/<recipe-hash>/` (`built`). mpv runs with an empty environment.
 * Never throws: a missing `shipped` fails every check, and a missing `built` fails the two that
 * compare against it, each naming `mise run mpv:build`.
 */
export const mpvBundleChecks = (shipped: string, built: string): MpvBundleCheck[] => {
  const notShipped = existsSync(shipped) ? [] : ["resources/mpv: not in the AppImage"];

  const notBuilt = existsSync(built)
    ? []
    : [`${path.basename(built)}: no build of the current recipe; run \`mise run mpv:build\``];

  const check = (
    name: string,
    needsBuilt: boolean,
    problems: () => readonly string[]
  ): MpvBundleCheck => {
    const missing = [...notShipped, ...(needsBuilt ? notBuilt : [])];

    return missing.length > 0 ? { name, problems: missing } : guarded(name, problems);
  };

  return [
    check("mpv is this recipe's build", true, () => sameFiles(shipped, built)),
    check("mpv runs", true, () => runs(shipped, built)),
    check("mpv decoders", false, () => [
      ...lists(shipped, ["--vd=help"], ["hevc", "h264", "vc1", "av1"]),
      ...lists(shipped, ["--ad=help"], ["truehd", "eac3", "dca"]),
      ...lists(shipped, ["--list-options"], ["--input-gamepad"]),
    ]),
    check("mpv host libs", false, () =>
      unbundledNeeds(shipped, readHostLibs(path.join(repoRootFrom(import.meta.dirname), "mpv")))
    ),
    check("mpv licenses", false, () => licenseGaps(shipped)),
  ];
};

/** Every problem of every check in `mpvBundleChecks`; empty when the shipped bundle is the build. */
export const mpvBundleProblems = (shipped: string, built: string): string[] =>
  mpvBundleChecks(shipped, built).flatMap((check) => check.problems);
