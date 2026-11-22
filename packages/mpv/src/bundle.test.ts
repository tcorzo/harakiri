import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { bundledMpv, repoRootFrom } from "./bundle";
import { exportedSymbols, neededLibs } from "./elf";
import { bundleFiles, readHostLibs, shaderCompilerExports, unbundledNeeds } from "./host-libs";

// The real build in .cache/mpv/<recipe-hash>. With none, bundledMpv() throws naming `mise run mpv:build`.
const recipe = path.join(repoRootFrom(import.meta.dirname), "mpv");

const Manifest = z.object({
  mpv: z.string(),
  libplacebo: z.string(),
  ffmpeg: z.string(),
  sdl2: z.string(),
  nvCodecHeaders: z.string(),
  curl: z.string(),
  caBundle: z.string(),
});

/** A version mpv/versions.env pins, e.g. `pinned("CURL")`. */
const pinned = (name: string): string => {
  const env = readFileSync(path.join(recipe, "versions.env"), "utf-8");
  const version = new RegExp(`^${name}_VERSION=(?<version>\\S+)$`, "mu").exec(env)?.groups?.version;

  if (version === undefined) {
    throw new Error(`mpv/versions.env pins no ${name}_VERSION`);
  }

  return version;
};

const run = (...args: string[]): string =>
  execFileSync(bundledMpv(), ["--no-config", ...args], { encoding: "utf-8" });

const bundleFile = (rel: string): string => path.join(path.dirname(bundledMpv()), rel);

const readAvcodec = (): string => {
  const lib = bundleFile("lib");
  const name = readdirSync(lib).find((file) => file.startsWith("libavcodec.so."));

  if (name === undefined) {
    throw new Error(`no libavcodec.so.* in ${lib}`);
  }

  return readFileSync(path.join(lib, name)).toString("latin1");
};

// The libraries of the shader compiler libplacebo links: shaderc, glslang and SPIRV-Tools
const shaderCompilerLib = /^lib(?:shaderc|glslang|SPIRV)/u;

/** The bundle's lib/libplacebo.so.<abi> */
const libplacebo = (): string => {
  const lib = bundleFile("lib");
  const name = readdirSync(lib).find((file) => file.startsWith("libplacebo.so."));

  if (name === undefined) {
    throw new Error(`no libplacebo.so.* in ${lib}`);
  }

  return path.join(lib, name);
};

describe("harakiri's mpv build", () => {
  it("is mpv 0.42.0 on libplacebo 7.387.0 and FFmpeg 9.0.2", () => {
    const version = run("--version");
    expect(version).toMatch(/^mpv v0\.42\.0 /mu);
    expect(version).toMatch(/^libplacebo version: v7\.387\.0$/mu);
    expect(version).toMatch(/^FFmpeg version: 9\.0\.2$/mu);
  });

  it("is configured with SDL2 gamepad input and the libcurl backend, and without libmpv (#13)", () => {
    const configuration =
      /Configuration: (?<flags>.*)$/mu.exec(run("-v", "--version"))?.groups?.flags ?? "";

    for (const flag of [
      "-Dsdl2-gamepad=enabled",
      "-Dlibcurl=enabled",
      "-Dlibmpv=false",
      "-Dgpl=true",
    ]) {
      expect(configuration).toContain(flag);
    }
  });

  it("reads http through the libcurl versions.env pins, not the 8.18.0 that stalls seeks (curl #20641)", () => {
    // curl_version() builds "libcurl/<version>" from a literal compiled into the library
    const libcurl = readFileSync(bundleFile("lib/libcurl.so.4")).toString("latin1");
    expect(/libcurl\/(?<version>\d+\.\d+\.\d+)/u.exec(libcurl)?.groups?.version).toBe(
      pinned("CURL")
    );
    expect(
      Manifest.parse(JSON.parse(readFileSync(bundleFile("manifest.json"), "utf-8"))).curl
    ).toBe(pinned("CURL"));
  });

  it("has --input-gamepad, and verifies TLS by default", () => {
    const options = run("--list-options");
    expect(options).toMatch(/^\s*--input-gamepad\s/mu);
    expect(options).toMatch(/^\s*--tls-verify\s+Flag \(default: yes\)/mu);
  });

  it.each(["hevc", "h264", "vc1", "av1", "libdav1d"])("decodes video with %s", (decoder) => {
    expect(run("--vd=help")).toMatch(new RegExp(`^\\s*${decoder}\\s`, "mu"));
  });

  it.each(["truehd", "eac3", "dca", "ac3"])("decodes audio with %s", (decoder) => {
    expect(run("--ad=help")).toMatch(new RegExp(`^\\s*${decoder}\\s`, "mu"));
  });

  it.each(["vaapi", "nvdec", "vulkan"])("offers hwdec %s", (hwdec) => {
    expect(run("--hwdec=help")).toMatch(new RegExp(`^\\s*${hwdec}\\b`, "mu"));
  });

  it("needs nothing from the host beyond mpv/host-libs.txt", () => {
    expect(unbundledNeeds(path.dirname(bundledMpv()), readHostLibs(recipe))).toStrictEqual([]);
  });

  describe("leaves SPIRV-Tools to the host's Mesa drivers", () => {
    // Every host Vulkan driver and libgallium link libSPIRV-Tools.so, whose soname is unversioned
    // and whose API is C++. A copy the bundle loads, or symbols it exports, would bind the host's
    // drivers to the bundle's SPIRV-Tools. libplacebo links shaderc, glslang and SPIRV-Tools
    // statically and exports none of their symbols (mpv/build.sh).
    it("ships no shaderc, glslang or SPIRV-Tools library in lib/", () => {
      expect(
        readdirSync(bundleFile("lib")).filter((name) => shaderCompilerLib.test(name))
      ).toStrictEqual([]);
    });

    it("has no file that needs a shaderc, glslang or SPIRV-Tools library", () => {
      const needs = bundleFiles(path.dirname(bundledMpv())).flatMap((rel) =>
        neededLibs(bundleFile(rel))
          .filter((soname) => shaderCompilerLib.test(soname))
          .map((soname) => `${rel}: ${soname}`)
      );

      expect(needs).toStrictEqual([]);
    });

    it("exports no shaderc, glslang or SPIRV-Tools symbol from any file", () => {
      expect(shaderCompilerExports(path.dirname(bundledMpv()))).toStrictEqual([]);
    });

    it("exports only libplacebo's own symbols from libplacebo, whatever a leaked name looks like", () => {
      // libplacebo's API is pl_*; memcpy_layout and the std::__detail from_chars helpers of its
      // own C++ (convert.cc) leak at default visibility. 537 symbols on libplacebo 7.387.0.
      const foreign = exportedSymbols(libplacebo()).filter(
        (symbol) => !/^pl_|^memcpy_layout$|^_ZNSt8__detail/u.test(symbol)
      );

      expect(foreign).toStrictEqual([]);
    });
  });

  it("is FFmpeg under the GPL, never nonfree (Q4a)", () => {
    // av_license() is compiled into libavcodec as a string
    const avcodec = readAvcodec();
    expect(avcodec).toContain("GPL version 2 or later");
    expect(avcodec).not.toContain("nonfree and unredistributable");
  });

  it("finds this host's CA bundle where its libcurl looks", () => {
    const { caBundle } = Manifest.parse(
      JSON.parse(readFileSync(bundleFile("manifest.json"), "utf-8"))
    );

    // The failure names the path: the build's libcurl reads one fixed CA path
    const missing = existsSync(caBundle)
      ? undefined
      : `no CA bundle at ${caBundle}: the build's libcurl reads Fedora's path, so it is built ` +
        "for Fedora-family hosts; another host's CA path is a Phase 8 host capability";

    expect(missing).toBeUndefined();
  });
});
