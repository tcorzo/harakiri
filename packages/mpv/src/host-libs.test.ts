import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { exportedSymbols, neededLibs } from "./elf";
import {
  hostNeeds,
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

interface TinyElfOptions {
  /** e_shoff; 0 is a file with no section headers, as sstrip leaves it */
  shoff?: number;
  /** the .dynsym's sh_link, the index of its string table (section 1) */
  dynsymLink?: number;
  /** the .dynstr's sh_size */
  dynstrSize?: number;
}

const DYNSTR = "\0exported\0hidden\0imported\0";

/**
 * A minimal ELF64 little-endian file: sections null, .dynstr and .dynsym, and four symbols: the
 * null one, `exported` (global, default, defined), `hidden` (global, hidden, defined) and
 * `imported` (global, undefined).
 */
const tinyElf = (options: TinyElfOptions = {}): Buffer => {
  const dynstrAt = 64;
  const dynsymAt = 96;
  const shdrAt = dynsymAt + 4 * 24;
  const buf = Buffer.alloc(shdrAt + 3 * 64);

  buf.writeUInt32BE(0x7f_45_4c_46, 0);
  // EI_CLASS 64-bit, EI_DATA little-endian, EI_VERSION 1
  buf.writeUInt8(2, 4);
  buf.writeUInt8(1, 5);
  buf.writeUInt8(1, 6);
  // e_shoff, e_ehsize, e_shentsize, e_shnum
  buf.writeBigUInt64LE(BigInt(options.shoff ?? shdrAt), 40);
  buf.writeUInt16LE(64, 52);
  buf.writeUInt16LE(64, 58);
  buf.writeUInt16LE(3, 60);

  buf.write(DYNSTR, dynstrAt, "latin1");

  // st_name, st_info (binding << 4 | type), st_other (visibility), st_shndx
  const symbols = [
    [DYNSTR.indexOf("exported"), 0x12, 0, 1],
    [DYNSTR.indexOf("hidden"), 0x12, 2, 1],
    [DYNSTR.indexOf("imported"), 0x12, 0, 0],
  ];

  for (const [index, [name, info, other, shndx]] of symbols.entries()) {
    const at = dynsymAt + (index + 1) * 24;
    buf.writeUInt32LE(name ?? 0, at);
    buf.writeUInt8(info ?? 0, at + 4);
    buf.writeUInt8(other ?? 0, at + 5);
    buf.writeUInt16LE(shndx ?? 0, at + 6);
  }

  // section 1: .dynstr (SHT_STRTAB); section 2: .dynsym (SHT_DYNSYM)
  const sections = [
    [3, dynstrAt, options.dynstrSize ?? DYNSTR.length, 0],
    [11, dynsymAt, 4 * 24, options.dynsymLink ?? 1],
  ];

  for (const [index, [type, offset, size, link]] of sections.entries()) {
    const at = shdrAt + (index + 1) * 64;
    buf.writeUInt32LE(type ?? 0, at + 4);
    buf.writeBigUInt64LE(BigInt(offset ?? 0), at + 24);
    buf.writeBigUInt64LE(BigInt(size ?? 0), at + 32);
    buf.writeUInt32LE(link ?? 0, at + 40);
  }

  return buf;
};

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

    it("reads only the defined, default-visibility symbol of a crafted ELF", () => {
      const file = path.join(tmp, "tiny.so");
      writeFileSync(file, tinyElf());
      expect(exportedSymbols(file)).toStrictEqual(["exported"]);
    });

    it("refuses a file with no section headers, so a stripped file cannot pass as exporting nothing", () => {
      const file = path.join(tmp, "sstripped.so");
      writeFileSync(file, tinyElf({ shoff: 0 }));
      expect(() => exportedSymbols(file)).toThrow(`${file} has no .dynsym`);
    });

    it("refuses a .dynsym whose sh_link is not a string table", () => {
      const file = path.join(tmp, "bad-link.so");
      writeFileSync(file, tinyElf({ dynsymLink: 0 }));
      expect(() => exportedSymbols(file)).toThrow(
        `${file} has a .dynsym whose sh_link 0 is not a string table`
      );
    });

    it("refuses a symbol name that runs past its .dynstr", () => {
      const file = path.join(tmp, "short-dynstr.so");
      // "\0exported\0" ends at 10: the name starts inside and is unterminated within 5 bytes
      writeFileSync(file, tinyElf({ dynstrSize: 5 }));
      expect(() => exportedSymbols(file)).toThrow(`${file} has a symbol name outside its .dynstr`);
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
      ["libxml2.so.2", false],
      ["libXpresent.so.1", false],
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

  describe(hostNeeds, () => {
    it("lists each host lib that mpv or lib/ needs, once", () => {
      copyFileSync(process.execPath, path.join(tmp, "mpv"));
      mkdirSync(path.join(tmp, "lib"));
      copyFileSync(process.execPath, path.join(tmp, "lib", "libfoo.so.1"));
      expect(hostNeeds(tmp, ["libc.so.6", "libnothing.so.1"])).toStrictEqual(["libc.so.6"]);
    });

    it("does not list a host lib that lib/ holds", () => {
      copyFileSync(process.execPath, path.join(tmp, "mpv"));
      mkdirSync(path.join(tmp, "lib"));
      copyFileSync(process.execPath, path.join(tmp, "lib", "libc.so.6"));
      expect(hostNeeds(tmp, ["libc.so.6"])).toStrictEqual([]);
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
