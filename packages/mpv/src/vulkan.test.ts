import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { bundledMpv } from "./bundle";

// The Vulkan loader's system manifest dirs. A host driver is a manifest here whose library is a
// 64-bit ELF file on this host.
const ICD_DIRS = ["/etc/vulkan/icd.d", "/usr/share/vulkan/icd.d"];

// Only the system manifests: an override would hide the host's drivers from the check.
const LOADER_OVERRIDES = new Set([
  "VK_DRIVER_FILES",
  "VK_ICD_FILENAMES",
  "VK_ADD_DRIVER_FILES",
  "VK_LOADER_DRIVERS_SELECT",
  "VK_LOADER_DRIVERS_DISABLE",
]);

const IcdManifest = z.object({ ICD: z.object({ library_path: z.string() }) });

interface HostDriver {
  manifest: string;
  /** library_path as the manifest writes it, which is how the loader names it in its log */
  library: string;
}

const isElf64 = (file: string): boolean => {
  const header = Buffer.alloc(5);
  const fd = openSync(file, "r");

  try {
    readSync(fd, header, 0, 5, 0);
  } finally {
    closeSync(fd);
  }

  // \x7fELF, then EI_CLASS 2: 64-bit
  return header.readUInt32BE(0) === 0x7f_45_4c_46 && header[4] === 2;
};

/** The file the loader opens for a manifest's library_path: a path, or a soname ldconfig knows. */
const resolveLibrary = (library: string, manifestDir: string): string | undefined => {
  if (library.includes("/")) {
    const file = path.resolve(manifestDir, library);

    return existsSync(file) ? file : undefined;
  }

  const cache = execFileSync("ldconfig", ["-p"], { encoding: "utf-8" });

  return cache
    .split("\n")
    .map((line) => /^\s*(?<soname>\S+) \((?<flags>[^)]*)\) => (?<file>\S+)$/u.exec(line)?.groups)
    .find((entry) => entry?.soname === library && entry.flags?.includes("x86-64") === true)?.file;
};

const hostDrivers = (): HostDriver[] =>
  ICD_DIRS.filter((dir) => existsSync(dir)).flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name): HostDriver[] => {
        const manifest = path.join(dir, name);
        const { ICD } = IcdManifest.parse(JSON.parse(readFileSync(manifest, "utf-8")));

        const library = ICD.library_path;

        const file = resolveLibrary(library, dir);

        return file !== undefined && isElf64(file) ? [{ manifest, library }] : [];
      })
  );

/** `mpv --vulkan-device=help` with the loader logging each driver it loads or drops. */
const listVulkanDevices = (): string => {
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !LOADER_OVERRIDES.has(name))
    ),
    VK_LOADER_DEBUG: "error,driver",
  };

  const result = spawnSync(bundledMpv(), ["--no-config", "--vulkan-device=help"], {
    env,
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    throw new Error(`mpv --vulkan-device=help exited ${String(result.status)}: ${result.stderr}`);
  }

  return `${result.stdout}\n${result.stderr}`;
};

// A library in the bundle's lib/ is loaded before any driver, so a host Vulkan driver that needs
// the same soname binds to the bundle's copy. When that copy is older than the driver expects,
// the loader drops the driver and mpv loses the GPU (no gpu-next, no HDR).
describe("harakiri's mpv build on this host's Vulkan drivers", () => {
  it("loads every Vulkan driver the host installs, so no bundled library shadows one", () => {
    const log = listVulkanDevices();
    const host = new Set(hostDrivers().map((driver) => driver.library));

    // The loader scans the drivers more than once, so a dropped driver is logged more than once
    const dropped = [
      ...new Set(
        [
          ...log.matchAll(/Failed loading library associated with ICD JSON (?<library>\S+)\. /gu),
        ].flatMap((match) => {
          const library = match.groups?.library ?? "";

          return host.has(library) ? [library] : [];
        })
      ),
    ].map(
      (library) =>
        log
          .split("\n")
          .find((line) => line.includes("ERROR:") && line.includes(`${library}:`))
          ?.replace(/^.*ERROR:\s+/u, "") ?? library
    );

    // Each entry is the loader's reason, such as "undefined symbol": the bundle's lib/ holds an
    // older copy of a library that driver needs. Move that soname to mpv/host-libs.txt.
    expect(dropped).toStrictEqual([]);
  });

  it("lists lavapipe, the Vulkan driver mesa-vulkan-drivers installs on every host", () => {
    // Missing here: the host lacks mesa-vulkan-drivers, which CLAUDE.md requires
    expect(hostDrivers().map((driver) => path.basename(driver.manifest))).toContain(
      "lvp_icd.x86_64.json"
    );
    expect(listVulkanDevices()).toMatch(/^\s+'llvmpipe[^']*' \(GPU \d+/mu);
  });
});
