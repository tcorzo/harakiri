#!/usr/bin/env bun
/**
 * Fails when apps/desktop/dist does not match its own metadata: latest-linux.yml must describe the
 * AppImage (version, path, sha512, size), the embedded app-update.yml must point at the public
 * GitHub feed with no token, every package the main bundle imports must be packed in app.asar, and
 * the desktop entry must carry package.json's desktopName and harakiri's icon, not Electron's.
 * resources/mpv must be the current recipe's mpv build, byte for byte, and run with an empty
 * environment; the AppImage must carry harakiri's, Electron's and Chromium's licenses, and the
 * licenses of the npm code each bundle in app.asar holds.
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
import path from "node:path";

import desktopPackage from "../apps/desktop/package.json" with { type: "json" };
import { bundleDirIn } from "../packages/mpv/src/bundle";
import { mpvBundleChecks } from "../packages/mpv/src/release-check";

const root = path.resolve(import.meta.dirname, "..");
const dist = process.env.HARAKIRI_DIST ?? path.join(root, "apps/desktop/dist");
const mainOut = path.join(root, "apps/desktop/out/main");

interface UpdateFile {
  url?: string;
  sha512?: string;
  size?: number;
}

interface UpdateDocument {
  version?: string;
  path?: string;
  sha512?: string;
  files?: UpdateFile[];
  provider?: string;
  owner?: string;
  repo?: string;
  updaterCacheDirName?: string;
  token?: string;
}

interface BunRuntime {
  YAML: { parse: (text: string) => UpdateDocument };
}

const version = process.argv[2] ?? desktopPackage.version;

let failed = false;

const pass = (check: string) => {
  console.log(`ok: ${check}`);
};

const fail = (check: string, why: string) => {
  failed = true;
  console.log(`FAIL: ${check}: ${why}`);
};

const check = (name: string, why: string | undefined) => {
  if (why === undefined || why === "") {
    pass(name);
  } else {
    fail(name, why);
  }
};

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );

const specifiers = (source: string): Set<string> => {
  const found = new Set<string>();

  for (const m of source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'](?<spec>[^"']+)["']/gu
  )) {
    found.add(m.groups?.spec ?? "");
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

// bun's bundled types predate Bun.YAML in this setup and this config types only node, so the runtime is declared here.
declare const Bun: BunRuntime;

const parseYaml = (text: string): UpdateDocument => Bun.YAML.parse(text);

const meta = parseYaml(readFileSync(path.join(dist, "latest-linux.yml"), "utf-8"));
const entry = meta.files?.[0];

check(
  "version",
  meta.version === version
    ? undefined
    : `latest-linux.yml says ${meta.version}, expected ${version}`
);

const file = entry?.url === undefined || entry.url === "" ? undefined : path.join(dist, entry.url);

if (entry === undefined || file === undefined || !existsSync(file)) {
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

const tmp = mkdtempSync(path.join(tmpdir(), "harakiri-release-"));

try {
  // --appimage-extract works without FUSE.
  execFileSync(file, ["--appimage-extract", "resources/*"], { cwd: tmp, stdio: "ignore" });
  execFileSync(file, ["--appimage-extract", "*.desktop"], { cwd: tmp, stdio: "ignore" });
  // The root icon is a symlink into the hicolor theme.
  execFileSync(file, ["--appimage-extract", "*.png"], { cwd: tmp, stdio: "ignore" });
  execFileSync(file, ["--appimage-extract", "usr/share/icons/*"], { cwd: tmp, stdio: "ignore" });
  // harakiri's LICENSE, Electron's LICENSE.electron.txt and Chromium's LICENSES.chromium.html.
  execFileSync(file, ["--appimage-extract", "LICENSE*"], { cwd: tmp, stdio: "ignore" });
  const appDir = path.join(tmp, "squashfs-root");
  const resources = path.join(appDir, "resources");

  // The AppImage spec puts exactly one desktop entry at the root.
  const entryName = readdirSync(appDir).find((f) => f.endsWith(".desktop")) ?? "";
  const desktopEntry = readFileSync(path.join(appDir, entryName), "utf-8");
  const wmClass = desktopPackage.desktopName.replace(/\.desktop$/u, "");

  check(
    "desktop entry",
    [
      entryName !== desktopPackage.desktopName &&
        `the entry is ${entryName}, expected ${desktopPackage.desktopName}`,
      !desktopEntry.includes(`\nStartupWMClass=${wmClass}\n`) && `StartupWMClass is not ${wmClass}`,
    ]
      .filter(Boolean)
      .join("; ")
  );

  const iconName = /^Icon=(?<name>.+)$/mu.exec(desktopEntry)?.groups?.name ?? "";
  const iconPath = path.join(appDir, `${iconName}.png`);
  const iconsDir = path.join(root, "apps/desktop/build/icons");
  const ourIcons = new Set(readdirSync(iconsDir).map((f) => sha256(path.join(iconsDir, f))));

  check(
    "icon",
    existsSync(iconPath) && ourIcons.has(sha256(iconPath))
      ? undefined
      : `${iconName}.png is not one of apps/desktop/build/icons`
  );

  const steamFiles = ["portrait.png", "wide.png", "hero.png", "logo.png", "icon.png"];
  const missingArt = steamFiles.filter((f) => !existsSync(path.join(resources, "steam", f)));

  check(
    "Steam artwork packed",
    missingArt.length ? `resources/steam is missing ${missingArt.join(", ")}` : undefined
  );

  const feed = parseYaml(readFileSync(path.join(resources, "app-update.yml"), "utf-8"));

  const feedProblems = [
    feed.provider !== "github" && `provider is ${String(feed.provider)}`,
    feed.owner !== "tcorzo" && `owner is ${String(feed.owner)}`,
    feed.repo !== "harakiri" && `repo is ${String(feed.repo)}`,
    feed.updaterCacheDirName !== "harakiri-updater" &&
      `updaterCacheDirName is ${String(feed.updaterCacheDirName)}`,
    "token" in feed && "app-update.yml has a token key",
  ].filter(Boolean);

  check("feed", feedProblems.length ? feedProblems.join("; ") : undefined);

  // The AppImage's own copy, checked against the current recipe's build; never .cache/mpv alone.
  for (const { name, problems } of mpvBundleChecks(
    path.join(resources, "mpv"),
    bundleDirIn(root)
  )) {
    check(name, problems.join("; "));
  }

  const asarCli = (...args: string[]) =>
    execFileSync("bun", ["x", "--package", "@electron/asar@3.4.1", "asar", ...args], {
      cwd: tmp,
      encoding: "utf-8",
      maxBuffer: 2 ** 28,
    });

  const appAsar = path.join(resources, "app.asar");
  const asar = asarCli("list", appAsar);
  const asarEntries = new Set(asar.split("\n").map((line) => line.trim()));

  const ownLicense = path.join(appDir, "LICENSE");

  const bundleLicenses = ["renderer", "main", "preload"].map(
    (target) => `out/${target}/licenses.md`
  );

  const missingBundleLicenses = bundleLicenses.filter((rel) => !asarEntries.has(`/${rel}`));

  /** An entry of app.asar's text; extract-file writes it under its basename into tmp. */
  const asarText = (rel: string): string => {
    asarCli("extract-file", appAsar, rel);

    return readFileSync(path.join(tmp, path.basename(rel)), "utf-8");
  };

  const rendererLicenses = missingBundleLicenses.includes("out/renderer/licenses.md")
    ? ""
    : asarText("out/renderer/licenses.md");

  check(
    "licenses",
    [
      !existsSync(ownLicense) && "the AppImage root has no LICENSE",
      existsSync(ownLicense) &&
        sha256(ownLicense) !== sha256(path.join(root, "LICENSE")) &&
        "the AppImage's LICENSE is not the repo's",
      ...["LICENSE.electron.txt", "LICENSES.chromium.html"].map(
        (name) => !existsSync(path.join(appDir, name)) && `the AppImage root has no ${name}`
      ),
      missingBundleLicenses.length > 0 && `app.asar holds no ${missingBundleLicenses.join(", ")}`,
      rendererLicenses !== "" &&
        !/^## react - /mu.test(rendererLicenses) &&
        "out/renderer/licenses.md does not name react",
    ]
      .filter(Boolean)
      .join("; ")
  );

  const needed = new Set<string>();

  for (const js of walk(mainOut).filter((f) => f.endsWith(".js"))) {
    for (const spec of specifiers(readFileSync(js, "utf-8"))) {
      const pkg = packageOf(spec);

      if (pkg !== undefined) {
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
