import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { bundleFiles } from "./host-libs";

/** One component of the mpv bundle, as mpv/build.sh lists it in manifest.json's `components`. */
export interface Component {
  /** Its directory under licenses/: the recipe's name for what it builds, the RPM's %{NAME} for what it copies */
  readonly name: string;
  /** versions.env's pin, or the RPM's %{VERSION}-%{RELEASE} */
  readonly version: string;
  /** SPDX: Fedora's %{LICENSE}, or the recipe's for what it builds */
  readonly license: string;
  /** Paths relative to the bundle it provides ("lib/libass.so.9"); [] for a static or header-only component */
  readonly files: readonly string[];
  readonly source:
    | { readonly kind: "upstream"; readonly url: string; readonly sha256: string }
    | { readonly kind: "srpm"; readonly srpm: string };
}

const Source = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("upstream"),
      url: z.url({ protocol: /^https$/u }),
      sha256: z.string().regex(/^[\da-f]{64}$/u),
    })
    .strict(),
  z.object({ kind: z.literal("srpm"), srpm: z.string().regex(/^[^/]+\.src\.rpm$/u) }).strict(),
]);

export const Components: z.ZodType<readonly Component[]> = z
  .array(
    z
      .object({
        // A directory name under licenses/, never a path
        name: z.string().regex(/^[\da-z][\w+.-]*$/iu),
        version: z.string().min(1),
        license: z.string().min(1),
        files: z.array(z.string().min(1)).readonly(),
        source: Source,
      })
      .strict()
  )
  .readonly();

// manifest.json also holds each built component's version; only `components` is read here
const Manifest = z.object({ components: Components });

/** manifest.json's `components` in `bundleDir`. Throws when it is missing or malformed. */
export const bundleComponents = (bundleDir: string): readonly Component[] =>
  Manifest.parse(JSON.parse(readFileSync(path.join(bundleDir, "manifest.json"), "utf-8")))
    .components;

const isDir = (file: string): boolean => existsSync(file) && statSync(file).isDirectory();

const isFile = (file: string): boolean => existsSync(file) && statSync(file).isFile();

/** Whether `dir` is a directory that holds, at any depth, a file with at least one byte */
const holdsALicenseFile = (dir: string): boolean =>
  isDir(dir) &&
  readdirSync(dir, { recursive: true, withFileTypes: true }).some(
    (entry) => entry.isFile() && statSync(path.join(entry.parentPath, entry.name)).size > 0
  );

/** The license texts every bundle carries at the top of licenses/ */
const BUNDLE_LICENSES = ["README", "COPYING.GPLv3"];

const bundleLicenseGap = (licenses: string, name: string): string[] => {
  const file = path.join(licenses, name);

  if (!isFile(file)) {
    return [`licenses/${name}: missing`];
  }

  return statSync(file).size === 0 ? [`licenses/${name}: empty`] : [];
};

/** Each value that `keys` holds more than once, with every item that holds it, in order */
const duplicates = <T>(
  items: readonly T[],
  keys: (item: T) => readonly string[]
): Map<string, T[]> => {
  const byKey = new Map<string, T[]>();

  for (const item of items) {
    for (const key of keys(item)) {
      byKey.set(key, [...(byKey.get(key) ?? []), item]);
    }
  }

  return new Map([...byKey].filter(([, holders]) => holders.length > 1));
};

/**
 * One line per problem: a missing or empty licenses/README or licenses/COPYING.GPLv3, a bundle
 * file no component provides or two components provide, a file a component claims that the bundle
 * lacks, a name two components have, a component
 * with no non-empty license file in licenses/<name>/, an entry of licenses/ that is a file, and a
 * licenses/ dir no component names. Empty when the bundle is complete. Throws when manifest.json
 * is missing or its `components` is malformed.
 */
export const licenseGaps = (bundleDir: string): string[] => {
  const components = bundleComponents(bundleDir);

  const licenses = path.join(bundleDir, "licenses");
  const provided = new Set(components.flatMap((component) => component.files));
  const named = new Set(components.map((component) => component.name));

  const entries = isDir(licenses)
    ? readdirSync(licenses, { withFileTypes: true }).toSorted((a, b) =>
        a.name < b.name ? -1 : Number(a.name > b.name)
      )
    : [];

  return [
    ...BUNDLE_LICENSES.flatMap((name) => bundleLicenseGap(licenses, name)),
    ...bundleFiles(bundleDir).flatMap((rel) =>
      provided.has(rel) ? [] : [`${rel}: no component provides it`]
    ),
    ...components.flatMap((component) =>
      component.files
        .filter((rel) => !isFile(path.join(bundleDir, rel)))
        .map((rel) => `${rel}: claimed by ${component.name}, not in the bundle`)
    ),
    ...[...duplicates(components, (component) => component.files)].map(
      ([rel, holders]) =>
        `${rel}: provided by ${holders.length} components, ${holders.map((holder) => holder.name).join(" and ")}`
    ),
    ...[...duplicates(components, (component) => [component.name])].map(
      ([name, holders]) => `${name}: the name of ${holders.length} components`
    ),
    ...[...named].flatMap((name) =>
      holdsALicenseFile(path.join(licenses, name))
        ? []
        : [`${name}: no license file in licenses/${name}/`]
    ),
    ...entries.flatMap((entry) => {
      if (!entry.isDirectory()) {
        return BUNDLE_LICENSES.includes(entry.name)
          ? []
          : [`licenses/${entry.name}: a file, not a directory`];
      }

      return named.has(entry.name)
        ? []
        : [`licenses/${entry.name}/: no component named ${entry.name}`];
    }),
  ];
};
