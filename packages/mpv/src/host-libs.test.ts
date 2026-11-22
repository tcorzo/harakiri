import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { exportedSymbols, neededLibs } from "./elf";
import {
  isHostLib,
  isShaderCompilerSymbol,
  readHostLibs,
  shaderCompilerExports,
  unbundledNeeds,
} from "./host-libs";

// packages/mpv/src -> repo root -> mpv
const recipe = path.resolve(import.meta.dirname, "../../../mpv");

// node itself needs libatomic, which is not an mpv host lib
const nodeHostLibs = [...readHostLibs(recipe), "libatomic.so.*"];

let tmp = "";

describe("host libs", () => {
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "host-libs-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe(neededLibs, () => {
    it("reads the DT_NEEDED entries of a real ELF", () => {
      expect(neededLibs(process.execPath)).toContain("libc.so.6");
    });

    it("refuses a file that is not ELF64", () => {
      const text = path.join(tmp, "plain.txt");
      writeFileSync(text, "not an elf file, just text\n");
      expect(() => neededLibs(text)).toThrow(`${text} is not an ELF64 file`);
    });
  });

  describe(exportedSymbols, () => {
    it("reads the defined, visible dynamic symbols of a real ELF, and not the ones it imports", () => {
      // node exports N-API for native addons, and imports malloc from libc
      const symbols = exportedSymbols(process.execPath);
      expect(symbols).toContain("napi_create_object");
      expect(symbols).not.toContain("malloc");
    });

    it("refuses a file that is not ELF64", () => {
      const text = path.join(tmp, "plain.txt");
      writeFileSync(text, "not an elf file, just text\n");
      expect(() => exportedSymbols(text)).toThrow(`${text} is not an ELF64 file`);
    });
  });

  describe(isShaderCompilerSymbol, () => {
    it.each([
      // SPIRV-Tools: its C API, its C++ namespaces, and its free functions
      ["spvContextCreate", true],
      ["spvOptimizerRun", true],
      ["_ZN8spvtools3opt9Optimizer3RunEPKjmPSt6vectorIjSaIjEE", true],
      ["_Z10spvFixWordj16spv_endianness_t", true],
      ["_ZN8spvutils9HexFloatIfNS_6TraitsIfEEE4castEv", true],
      ["_ZNK3spv9Validator7isValidEv", true],
      // a std template instantiated over a SPIRV-Tools type
      ["_ZNSt6vectorIN8spvtools3opt11InstructionESaIS2_EE9push_backEOS2_", true],
      // shaderc and glslang
      ["shaderc_compile_into_spv", true],
      ["_ZN12shaderc_util8Compiler7CompileEv", true],
      ["_ZN7glslang7TShader5parseEv", true],
      ["glslang_initialize_process", true],
      ["ShCompile", true],
      // libplacebo's own exports
      ["pl_shader_alloc", false],
      ["memcpy_layout", false],
      ["_ZNSt8__detail22__from_chars_pow2_baseILb0EjEEbRPKcS2_RT0_i", false],
      // other libraries in the bundle
      ["SDL_Init", false],
      ["hb_shape", false],
      ["avcodec_send_packet", false],
    ])("isShaderCompilerSymbol(%j) is %j", (name, compiler) => {
      expect(isShaderCompilerSymbol(name)).toBe(compiler);
    });
  });

  describe(shaderCompilerExports, () => {
    it("is empty for a bundle whose files export no shader compiler symbol", () => {
      copyFileSync(process.execPath, path.join(tmp, "mpv"));
      expect(shaderCompilerExports(tmp)).toStrictEqual([]);
    });
  });

  describe(isHostLib, () => {
    it.each([
      ["libxcb-dri3.so.0", true],
      ["libX11.so.6", true],
      ["libva-drm.so.2", true],
      ["libz.so.1", true],
      ["libdisplay-info.so.3", true],
      ["libxml2.so.2", true],
      ["libva.so.3", false],
      ["libavcodec.so.62", false],
      ["libplacebo.so.351", false],
      ["libSDL2-2.0.so.0", false],
      ["libcurl.so.4", false],
    ])("isHostLib(%j) is %j against mpv/host-libs.txt", (soname, host) => {
      expect(isHostLib(soname, readHostLibs(recipe))).toBe(host);
    });
  });

  describe(readHostLibs, () => {
    it("skips comments and blank lines", () => {
      writeFileSync(path.join(tmp, "host-libs.txt"), "# x\n\nlibfoo.so.1\n");
      expect(readHostLibs(tmp)).toStrictEqual(["libfoo.so.1"]);
    });
  });

  describe(unbundledNeeds, () => {
    it("names each need that is neither in lib/ nor a host lib", () => {
      copyFileSync(process.execPath, path.join(tmp, "mpv"));
      expect(unbundledNeeds(tmp, [])).toContain("mpv: libc.so.6");
      expect(unbundledNeeds(tmp, nodeHostLibs)).toStrictEqual([]);
    });

    it("does not report a need satisfied by a file in lib/", () => {
      copyFileSync(process.execPath, path.join(tmp, "mpv"));
      mkdirSync(path.join(tmp, "lib"));
      copyFileSync(process.execPath, path.join(tmp, "lib", "libc.so.6"));
      const needs = unbundledNeeds(tmp, []);
      expect(needs).not.toContain("mpv: libc.so.6");
      expect(needs).toContain("lib/libc.so.6: libm.so.6");
    });
  });
});
