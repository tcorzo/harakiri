import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { bundledMpv, repoRootFrom } from "./bundle";
import { exportedSymbols, neededLibs } from "./elf";
import { bundleFiles, readHostLibs, shaderCompilerExports, unbundledNeeds } from "./host-libs";
import { Components, licenseGaps } from "./licenses";

// The real build in .cache/mpv/<recipe-hash>. With none, bundledMpv() throws naming `mise run mpv:build`.
const recipe = path.join(repoRootFrom(import.meta.dirname), "mpv");

const Manifest = z
  .object({
    mpv: z.string(),
    libplacebo: z.string(),
    ffmpeg: z.string(),
    sdl2: z.string(),
    nvCodecHeaders: z.string(),
    curl: z.string(),
    shaderc: z.string(),
    glslang: z.string(),
    spirvTools: z.string(),
    spirvHeaders: z.string(),
    components: Components,
  })
  .strict();

/** A value mpv/versions.env sets, e.g. `versionsEnv("CURL_VERSION")`. */
const versionsEnv = (key: string): string => {
  const env = readFileSync(path.join(recipe, "versions.env"), "utf-8");
  const value = new RegExp(`^${key}=(?<value>\\S+)$`, "mu").exec(env)?.groups?.value;

  if (value === undefined) {
    throw new Error(`mpv/versions.env sets no ${key}`);
  }

  return value;
};

/** A version mpv/versions.env pins, e.g. `pinned("CURL")`. */
const pinned = (name: string): string => versionsEnv(`${name}_VERSION`);

/** A tarball's sha256 mpv/versions.env pins, e.g. `pinnedSha("CURL")`. */
const pinnedSha = (name: string): string => versionsEnv(`${name}_SHA256`);

const run = (...args: string[]): string =>
  execFileSync(bundledMpv(), ["--no-config", ...args], { encoding: "utf-8" });

const bundleFile = (rel: string): string => path.join(path.dirname(bundledMpv()), rel);

const readManifest = (): z.infer<typeof Manifest> =>
  Manifest.parse(JSON.parse(readFileSync(bundleFile("manifest.json"), "utf-8")));

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
    expect(readManifest().curl).toBe(pinned("CURL"));
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

  it("takes OpenSSL from the host, and ships no Kerberos (curl has no GSS-API)", () => {
    const shipped = readdirSync(bundleFile("lib"));
    expect(
      shipped.filter((f) =>
        /^lib(?:ssl|crypto|krb5|gssapi_krb5|k5crypto|krb5support|keyutils|com_err)\.so/u.test(f)
      )
    ).toStrictEqual([]);
    expect(neededLibs(bundleFile("lib/libcurl.so.4")).toSorted()).toStrictEqual([
      "libc.so.6",
      "libcrypto.so.3",
      "libidn2.so.0",
      "libnghttp2.so.14",
      "libssl.so.3",
      "libz.so.1",
    ]);
  });

  it("has a manifest of the pinned versions and the components, with no CA bundle path", () => {
    expect(
      Object.keys(
        z
          .record(z.string(), z.unknown())
          .parse(JSON.parse(readFileSync(bundleFile("manifest.json"), "utf-8")))
      ).toSorted()
    ).toStrictEqual([
      "components",
      "curl",
      "ffmpeg",
      "glslang",
      "libplacebo",
      "mpv",
      "nvCodecHeaders",
      "sdl2",
      "shaderc",
      "spirvHeaders",
      "spirvTools",
    ]);
  });

  describe("carries its licenses and its source list", () => {
    it("has a license file for every file it ships and every component it names", () => {
      expect(licenseGaps(path.dirname(bundledMpv()))).toStrictEqual([]);
    });

    it("names the ten components it builds and the Fedora 44 packages it copies", () => {
      expect(readManifest().components.map((component) => component.name)).toStrictEqual([
        "bzip2-libs",
        "curl",
        "ffmpeg",
        "fontconfig",
        "freetype",
        "fribidi",
        "glib2",
        "glslang",
        "graphite2",
        "harfbuzz",
        "lcms2",
        "libXpresent",
        "libass",
        "libbrotli",
        "libdav1d",
        "libidn2",
        "libnghttp2",
        "libplacebo",
        "libpng",
        "libunibreak",
        "libunistring",
        "libxml2",
        "luajit",
        "mpv",
        "nv-codec-headers",
        "pcre2",
        "sdl2",
        "shaderc",
        "spirv-headers",
        "spirv-tools",
        "uchardet",
        "xz-libs",
        "zimg",
      ]);
    });

    it("has FFmpeg under GPL-2.0-or-later, and the GPLv3 text the bundle conveys under", () => {
      expect(readManifest().components.find((c) => c.name === "ffmpeg")?.license).toBe(
        "GPL-2.0-or-later"
      );

      const [title, version] = readFileSync(bundleFile("licenses/COPYING.GPLv3"), "utf-8")
        .split("\n")
        .map((line) => line.trim());

      expect(title).toBe("GNU GENERAL PUBLIC LICENSE");
      expect(version).toBe("Version 3, 29 June 2007");
    });

    it("has the licenses of SDL's bundled hidapi and the notice of each NVIDIA codec header", () => {
      // -DSDL_HIDAPI=ON compiles SDL's own hidapi into libSDL2
      expect(readdirSync(bundleFile("licenses/sdl2/src/hidapi")).toSorted()).toStrictEqual([
        "LICENSE-bsd.txt",
        "LICENSE-gpl3.txt",
        "LICENSE-orig.txt",
        "LICENSE.txt",
      ]);
      expect(readdirSync(bundleFile("licenses/nv-codec-headers")).toSorted()).toStrictEqual([
        "dynlink_cuda.h.notice",
        "dynlink_cuviddec.h.notice",
        "dynlink_loader.h.notice",
        "dynlink_nvcuvid.h.notice",
        "nvEncodeAPI.h.notice",
      ]);
    });

    it("takes every copied library from a Fedora 44 SRPM", () => {
      // A Fedora release tag is .fc44, or .fc44.<n> for a rebuild within the release (pcre2's 1.fc44.1)
      const srpms = readManifest().components.flatMap((c) =>
        c.source.kind === "srpm" ? [c.source.srpm] : []
      );

      expect(srpms.filter((srpm) => !/\.fc44(?:\.\d+)?\.src\.rpm$/u.test(srpm))).toStrictEqual([]);
      expect(srpms).toHaveLength(23);
    });

    it("lists one SOURCES.txt line per component, in the manifest's order", () => {
      const lines = readFileSync(bundleFile("SOURCES.txt"), "utf-8").trimEnd().split("\n");
      expect(lines.map((line) => line.split("\t")[0])).toStrictEqual(
        readManifest().components.map((component) => component.name)
      );
      expect(lines.find((line) => line.startsWith("ffmpeg\t"))).toBe(
        [
          "ffmpeg",
          pinned("FFMPEG"),
          "GPL-2.0-or-later",
          versionsEnv("FFMPEG_URL"),
          pinnedSha("FFMPEG"),
        ].join("\t")
      );
    });

    it("writes how it was built: FFmpeg's configure line, the meson lines and curl's CMake line", () => {
      const building = readFileSync(bundleFile("BUILDING.txt"), "utf-8");
      expect(building).toMatch(/^\.\/configure .*--enable-gpl /mu);
      expect(building).toMatch(/^meson setup .* -Dshaderc=enabled /mu);
      expect(building).toMatch(/^meson setup .* -Dgpl=true /mu);
      expect(building).toMatch(/^cmake .* -DCURL_USE_GSSAPI=OFF /mu);
    });
  });
});
