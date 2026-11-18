#!/usr/bin/env bun
/**
 * Fails when apps/desktop/dist does not match its own metadata: latest-linux.yml must describe the
 * AppImage (version, path, sha512, size), the embedded app-update.yml must point at the public
 * GitHub feed with no token, and every package the main bundle imports must be packed in app.asar.
 *
 *   bun scripts/check-release.ts [version]   version defaults to apps/desktop/package.json's
 *
 * HARAKIRI_DIST overrides the dist directory (used to prove the check fails on a tampered copy).
 * Prints `ok: <check>` or `FAIL: <check>: <why>` per check and exits 1 on any failure.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = process.env.HARAKIRI_DIST ?? join(root, "apps/desktop/dist");
const mainOut = join(root, "apps/desktop/out/main");

const version =
  process.argv[2] ??
  JSON.parse(readFileSync(join(root, "apps/desktop/package.json"), "utf8")).version;

let failed = false;
const pass = (check: string) => console.log(`ok: ${check}`);

const fail = (check: string, why: string) => {
  failed = true;
  console.log(`FAIL: ${check}: ${why}`);
};

const check = (name: string, why: string | undefined) => (why ? fail(name, why) : pass(name));

type Meta = {
  version?: string;
  path?: string;
  sha512?: string;
  files?: { url?: string; sha512?: string; size?: number }[];
};

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
  );

const specifiers = (source: string): Set<string> => {
  const found = new Set<string>();

  for (const m of source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g
  )) {
    found.add(m[1] ?? "");
  }

  return found;
};

const packageOf = (spec: string): string | undefined => {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) {
    return undefined;
  }
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? spec);

  if (name === "electron" || builtinModules.includes(name)) {
    return undefined;
  }

  return name;
};

// bun's bundled types predate Bun.YAML in this setup, so it is typed here at the one edge that uses it.
const parseYaml = (text: string): unknown =>
  (Bun as unknown as { YAML: { parse: (text: string) => unknown } }).YAML.parse(text);

const meta: Meta = parseYaml(readFileSync(join(dist, "latest-linux.yml"), "utf8")) as Meta;
const entry = meta.files?.[0];

check(
  "version",
  meta.version === version
    ? undefined
    : `latest-linux.yml says ${meta.version}, expected ${version}`
);

const file = entry?.url ? join(dist, entry.url) : undefined;

if (!file || !existsSync(file)) {
  fail("artifact", `${file ?? "files[0].url missing"} does not exist`);
  process.exit(1);
}

check(
  "artifact",
  meta.path === entry.url ? undefined : `path ${meta.path} differs from files[0].url ${entry.url}`
);

const digest = createHash("sha512").update(readFileSync(file)).digest("base64");

check(
  "sha512",
  entry.sha512 === digest && meta.sha512 === digest
    ? undefined
    : `file is ${digest}, files[0] says ${entry.sha512}, top level says ${meta.sha512}`
);

check(
  "size",
  entry.size === statSync(file).size
    ? undefined
    : `file is ${statSync(file).size}, files[0] says ${entry.size}`
);

const tmp = mkdtempSync(join(tmpdir(), "harakiri-release-"));

try {
  // --appimage-extract works without FUSE.
  execFileSync(file, ["--appimage-extract", "resources/*"], { cwd: tmp, stdio: "ignore" });
  const resources = join(tmp, "squashfs-root/resources");

  const feed = parseYaml(readFileSync(join(resources, "app-update.yml"), "utf8")) as Record<
    string,
    unknown
  >;

  const feedProblems = [
    feed.provider !== "github" && `provider is ${String(feed.provider)}`,
    feed.owner !== "tcorzo" && `owner is ${String(feed.owner)}`,
    feed.repo !== "harakiri" && `repo is ${String(feed.repo)}`,
    feed.updaterCacheDirName !== "harakiri-updater" &&
      `updaterCacheDirName is ${String(feed.updaterCacheDirName)}`,
    "token" in feed && "app-update.yml has a token key",
  ].filter(Boolean);

  check("feed", feedProblems.length ? feedProblems.join("; ") : undefined);

  const asar = execFileSync(
    "bun",
    ["x", "--package", "@electron/asar@3.4.1", "asar", "list", join(resources, "app.asar")],
    { encoding: "utf8", maxBuffer: 1 << 28 }
  );

  const needed = new Set<string>();

  for (const js of walk(mainOut).filter((f) => f.endsWith(".js"))) {
    for (const spec of specifiers(readFileSync(js, "utf8"))) {
      const pkg = packageOf(spec);

      if (pkg) {
        needed.add(pkg);
      }
    }
  }

  const missing = [...needed].filter((pkg) => !asar.includes(`/node_modules/${pkg}/package.json`));
  check(
    "runtime deps",
    missing.length ? `not packed in app.asar: ${missing.join(", ")}` : undefined
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
