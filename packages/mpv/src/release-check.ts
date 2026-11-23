import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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

/** Every file under dir, as `/`-separated paths relative to it, sorted. */
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) =>
      path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/")
    )
    .toSorted((a, b) => (a < b ? -1 : Number(a > b)));

const sha256 = (file: string): string =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

/** The first file of `built` that `shipped` lacks or holds other bytes of, and the first file only `shipped` has. */
const sameFiles = (shipped: string, built: string): string[] => {
  const shippedFiles = new Set(filesUnder(shipped));
  const builtFiles = filesUnder(built);
  const builtSet = new Set(builtFiles);

  const differs = builtFiles.find(
    (rel) =>
      !shippedFiles.has(rel) || sha256(path.join(shipped, rel)) !== sha256(path.join(built, rel))
  );

  const extra = [...shippedFiles].find((rel) => !builtSet.has(rel));

  return [
    ...(differs === undefined ? [] : [`${differs}: differs from the recipe's build`]),
    ...(extra === undefined ? [] : [`${extra}: not in the recipe's build`]),
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
    problemOf(
      run,
      (output) => new RegExp(`^\\s*${name}\\s`, "mu").test(output),
      `${args.join(" ")} lists no ${name}`
    )
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

/**
 * The checks on the mpv bundle an AppImage ships in `resources/mpv/` (`shipped`), against the
 * recipe's build in `.cache/mpv/<recipe-hash>/` (`built`). mpv runs with an empty environment.
 */
export const mpvBundleChecks = (shipped: string, built: string): MpvBundleCheck[] => [
  { name: "mpv is this recipe's build", problems: sameFiles(shipped, built) },
  { name: "mpv runs", problems: runs(shipped, built) },
  {
    name: "mpv decoders",
    problems: [
      ...lists(shipped, ["--vd=help"], ["hevc", "h264", "vc1", "av1"]),
      ...lists(shipped, ["--ad=help"], ["truehd", "eac3", "dca"]),
      ...lists(shipped, ["--list-options"], ["--input-gamepad"]),
    ],
  },
  {
    name: "mpv host libs",
    problems: unbundledNeeds(
      shipped,
      readHostLibs(path.join(repoRootFrom(import.meta.dirname), "mpv"))
    ),
  },
  { name: "mpv licenses", problems: licenseGaps(shipped) },
];

/** Every problem of every check in `mpvBundleChecks`; empty when the shipped bundle is the build. */
export const mpvBundleProblems = (shipped: string, built: string): string[] =>
  mpvBundleChecks(shipped, built).flatMap((check) => check.problems);
