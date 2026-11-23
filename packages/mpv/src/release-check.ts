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

/** How a check starts the shipped mpv. */
export interface MpvInvocation {
  readonly file: string;
  readonly args: readonly string[];
  /** The environment of `file`; undefined inherits this process's (podman needs it). */
  readonly env: Readonly<Record<string, string>> | undefined;
}

/** Where the shipped bundle is mounted, read-only, in the check image. */
const IMAGE_BUNDLE = "/opt/harakiri-mpv";

/**
 * The image `HARAKIRI_MPV_CHECK_IMAGE` names in `env`, or undefined when it is unset or empty.
 * The release job sets it: its runner's glibc is older than the bundle's Fedora 44 floor.
 */
export const mpvCheckImage = (env: Readonly<Record<string, string | undefined>>) => {
  const image = env.HARAKIRI_MPV_CHECK_IMAGE?.trim() ?? "";

  return image === "" ? undefined : image;
};

/**
 * `<shipped>/mpv --no-config <args>` with an empty environment: no inherited library path, no
 * config. With an `image` (`mise run package:check-image` builds one), mpv runs in podman on that
 * image instead, with no network and the bundle mounted read-only, and gets the image's
 * environment.
 */
export const mpvInvocation = (
  shipped: string,
  args: readonly string[],
  image: string | undefined
): MpvInvocation =>
  image === undefined
    ? { file: path.join(shipped, "mpv"), args: ["--no-config", ...args], env: {} }
    : {
        file: "podman",
        args: [
          "run",
          "--rm",
          "--pull=never",
          "--network=none",
          "--memory=1g",
          `--volume=${shipped}:${IMAGE_BUNDLE}:ro,Z`,
          image,
          `${IMAGE_BUNDLE}/mpv`,
          "--no-config",
          ...args,
        ],
        env: undefined,
      };

type Run = { ok: true; output: string } | { ok: false; problem: string };

/** What execFileSync throws: its message, and with `encoding` set, the child's stderr. */
const ExecFailure = z.object({ message: z.string(), stderr: z.string().catch("") });

type ExecFailure = z.infer<typeof ExecFailure>;

/** The first line of a failed run's stderr (the loader's error, say), else of its error. */
const whyFailed = (failure: ExecFailure): string =>
  [failure.stderr, failure.message]
    .flatMap((text) => text.split("\n"))
    .map((line) => line.trim())
    .find((line) => line !== "") ?? "";

/** Runs the shipped mpv as `mpvInvocation` says. */
const runMpv = (shipped: string, args: readonly string[], image: string | undefined): Run => {
  const { file, args: argv, env } = mpvInvocation(shipped, args, image);

  try {
    return {
      ok: true,
      output: execFileSync(file, argv, {
        encoding: "utf-8",
        env,
        maxBuffer: 2 ** 24,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    const failure = ExecFailure.catch({ message: String(error), stderr: "" }).parse(error);

    return { ok: false, problem: `mpv ${args.join(" ")} failed: ${whyFailed(failure)}` };
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
const escapeRegExp = (text: string): string => text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, "\\$&");

const lists = (
  shipped: string,
  args: readonly string[],
  names: readonly string[],
  image: string | undefined
): string[] => {
  const run = runMpv(shipped, args, image);

  if (!run.ok) {
    return [run.problem];
  }

  return names.flatMap((name) =>
    new RegExp(`^\\s*${escapeRegExp(name)}\\s`, "mu").test(run.output)
      ? []
      : [`${args.join(" ")} lists no ${name}`]
  );
};

/** mpv --version prints the built manifest's mpv version, and -v names SDL2 gamepad input. */
const runs = (shipped: string, built: string, image: string | undefined): string[] => {
  const { mpv } = ManifestVersion.parse(
    JSON.parse(readFileSync(path.join(built, "manifest.json"), "utf-8"))
  );

  return [
    ...problemOf(
      runMpv(shipped, ["--version"], image),
      (output) => new RegExp(`^mpv v${escapeRegExp(mpv)} `, "mu").test(output),
      `--version does not print mpv v${mpv}`
    ),
    ...problemOf(
      runMpv(shipped, ["-v", "--version"], image),
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
 * recipe's build in `.cache/mpv/<recipe-hash>/` (`built`). mpv runs with an empty environment,
 * or in the `image` podman runs (see `mpvInvocation`).
 * Never throws: a missing `shipped` fails every check, and a missing `built` fails the two that
 * compare against it, each naming `mise run mpv:build`.
 */
export const mpvBundleChecks = (
  shipped: string,
  built: string,
  image?: string
): MpvBundleCheck[] => {
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
    check("mpv runs", true, () => runs(shipped, built, image)),
    check("mpv decoders", false, () => [
      ...lists(shipped, ["--vd=help"], ["hevc", "h264", "vc1", "av1"], image),
      ...lists(shipped, ["--ad=help"], ["truehd", "eac3", "dca"], image),
      ...lists(shipped, ["--list-options"], ["--input-gamepad"], image),
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
