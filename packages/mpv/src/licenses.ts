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

const isFile = (file: string): boolean => existsSync(file) && statSync(file).isFile();

const holdsAFile = (dir: string): boolean =>
  existsSync(dir) &&
  readdirSync(dir, { recursive: true, withFileTypes: true }).some((entry) => entry.isFile());

/** The license texts every bundle carries at the top of licenses/ */
const BUNDLE_LICENSES = ["README", "COPYING.GPLv3"];

/**
 * One line per problem: a bundle file no component provides, a component with no license file, a
 * licenses/ dir no component names. Empty when the bundle is complete. Throws when manifest.json
 * is missing or its `components` is malformed.
 */
export const licenseGaps = (bundleDir: string): string[] => {
  const { components } = Manifest.parse(
    JSON.parse(readFileSync(path.join(bundleDir, "manifest.json"), "utf-8"))
  );

  const licenses = path.join(bundleDir, "licenses");
  const provided = new Set(components.flatMap((component) => component.files));
  const named = new Set(components.map((component) => component.name));

  const dirs = existsSync(licenses)
    ? readdirSync(licenses, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? [entry.name] : []
      )
    : [];

  return [
    ...BUNDLE_LICENSES.flatMap((name) =>
      isFile(path.join(licenses, name)) ? [] : [`licenses/${name}: missing`]
    ),
    ...bundleFiles(bundleDir).flatMap((rel) =>
      provided.has(rel) ? [] : [`${rel}: no component provides it`]
    ),
    ...components.flatMap(({ name }) =>
      holdsAFile(path.join(licenses, name)) ? [] : [`${name}: no license file in licenses/${name}/`]
    ),
    ...dirs.flatMap((dir) =>
      named.has(dir) ? [] : [`licenses/${dir}/: no component named ${dir}`]
    ),
  ];
};
