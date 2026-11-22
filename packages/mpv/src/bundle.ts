import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const HASH_LENGTH = 16;
const VERSIONS_FILE = "mpv/versions.env";

/** 16 hex digits over every file under recipeDir: relative path and bytes, sorted by path. */
export const recipeHash = (recipeDir: string): string => {
  const files = readdirSync(recipeDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);

      return { file, rel: path.relative(recipeDir, file).split(path.sep).join("/") };
    })
    .toSorted((a, b) => {
      if (a.rel < b.rel) {
        return -1;
      }

      return a.rel > b.rel ? 1 : 0;
    });

  const hash = createHash("sha256");

  for (const { file, rel } of files) {
    const bytes = readFileSync(file);
    hash.update(`${rel}\0${bytes.length}\0`);
    hash.update(bytes);
  }

  return hash.digest("hex").slice(0, HASH_LENGTH);
};

/** The first directory at or above `from` that holds mpv/versions.env; throws `No mpv/versions.env above ${from}`. */
export const repoRootFrom = (from: string): string => {
  let dir = path.resolve(from);

  for (;;) {
    if (existsSync(path.join(dir, VERSIONS_FILE))) {
      return dir;
    }

    const parent = path.dirname(dir);

    if (parent === dir) {
      throw new Error(`No ${VERSIONS_FILE} above ${from}`);
    }

    dir = parent;
  }
};

/** `<root>/.cache/mpv/<recipeHash(<root>/mpv)>`. It does not check that the dir exists. */
export const bundleDirIn = (root: string): string =>
  path.join(root, ".cache/mpv", recipeHash(path.join(root, "mpv")));

/** `<bundleDirIn(root)>/mpv`; throws the "is missing" copy when that file is absent. */
export const bundledMpvIn = (root: string): string => {
  const dir = bundleDirIn(root);
  const binary = path.join(dir, "mpv");

  if (!existsSync(binary)) {
    throw new Error(
      `harakiri's mpv build ${path.basename(dir)} is missing (${dir}): run \`mise run mpv:build\``
    );
  }

  return binary;
};

// A long-running dev app keeps the path it first resolved, even after `mise run mpv:build` makes a
// build with a new hash and deletes the old one: restart it after a rebuild.
let resolved: string | undefined;

/** bundledMpvIn(repoRootFrom(import.meta.dirname)), memoized. A failure is not kept. */
export const bundledMpv = (): string => {
  resolved ??= bundledMpvIn(repoRootFrom(import.meta.dirname));

  return resolved;
};
