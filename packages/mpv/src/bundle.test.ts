import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { bundledMpv, repoRootFrom } from "./bundle";
import { readHostLibs, unbundledNeeds } from "./host-libs";

// The real build in .cache/mpv/<recipe-hash>. With none, bundledMpv() throws naming `mise run mpv:build`.
const recipe = path.join(repoRootFrom(import.meta.dirname), "mpv");

const Manifest = z.object({
  mpv: z.string(),
  libplacebo: z.string(),
  ffmpeg: z.string(),
  sdl2: z.string(),
  nvCodecHeaders: z.string(),
  caBundle: z.string(),
});

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

  it("is FFmpeg under the GPL, never nonfree (Q4a)", () => {
    // av_license() is compiled into libavcodec as a string
    const avcodec = readAvcodec();
    expect(avcodec).toContain("GPL version 2 or later");
    expect(avcodec).not.toContain("nonfree and unredistributable");
  });

  it("finds this host's CA bundle where its libcurl looks", () => {
    const manifest = bundleFile("manifest.json");
    expect(existsSync(Manifest.parse(JSON.parse(readFileSync(manifest, "utf-8"))).caBundle)).toBe(
      true
    );
  });
});
