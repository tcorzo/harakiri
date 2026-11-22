import { readFileSync } from "node:fs";

const PT_LOAD = 1;
const PT_DYNAMIC = 2;
const DT_NULL = 0n;
const DT_NEEDED = 1n;
const DT_STRTAB = 5n;
const SHT_DYNSYM = 11;
const SHN_UNDEF = 0;
const STB_GLOBAL = 1;
const STB_WEAK = 2;

// GCC's binding for a C++ template's static data member (and an inline function's static
// variable): the dynamic linker keeps one definition for the whole process
const STB_GNU_UNIQUE = 10;
const STV_DEFAULT = 0;
const STV_PROTECTED = 3;
const SYM_SIZE = 24;
const SHDR_SIZE = 64;

interface Segment {
  offset: bigint;
  vaddr: bigint;
  filesz: bigint;
}

/** The fields of an Elf64_Shdr that exportedSymbols reads */
interface Section {
  type: number;
  offset: number;
  size: number;
  link: number;
}

/** The bytes of an ELF64 little-endian file. Throws `${file} is not an ELF64 file`. */
const readElf64 = (file: string): Buffer => {
  const buf = readFileSync(file);

  const isElf64Le =
    buf.length >= 64 &&
    buf.readUInt32BE(0) === 0x7f_45_4c_46 &&
    // EI_CLASS: 64-bit
    buf[4] === 2 &&
    // EI_DATA: little-endian
    buf[5] === 1;

  if (!isElf64Le) {
    throw new Error(`${file} is not an ELF64 file`);
  }

  return buf;
};

/** The DT_NEEDED sonames of an ELF64 little-endian file, in file order. Throws `${file} is not an ELF64 file`. */
export const neededLibs = (file: string): string[] => {
  const buf = readElf64(file);

  const phoff = Number(buf.readBigUInt64LE(32));
  const phentsize = buf.readUInt16LE(54);
  const phnum = buf.readUInt16LE(56);

  const loads: Segment[] = [];
  let dynamic: Segment | undefined;

  for (let i = 0; i < phnum; i += 1) {
    const at = phoff + i * phentsize;
    const type = buf.readUInt32LE(at);

    const segment: Segment = {
      offset: buf.readBigUInt64LE(at + 8),
      vaddr: buf.readBigUInt64LE(at + 16),
      filesz: buf.readBigUInt64LE(at + 32),
    };

    if (type === PT_LOAD) {
      loads.push(segment);
    } else if (type === PT_DYNAMIC) {
      dynamic = segment;
    }
  }

  if (!dynamic) {
    return [];
  }

  const needed: bigint[] = [];
  let strtabAddr: bigint | undefined;
  const end = Number(dynamic.offset + dynamic.filesz);

  for (let at = Number(dynamic.offset); at + 16 <= end; at += 16) {
    const tag = buf.readBigInt64LE(at);

    if (tag === DT_NULL) {
      break;
    }

    const value = buf.readBigUInt64LE(at + 8);

    if (tag === DT_NEEDED) {
      needed.push(value);
    } else if (tag === DT_STRTAB) {
      strtabAddr = value;
    }
  }

  if (needed.length === 0) {
    return [];
  }

  if (strtabAddr === undefined) {
    throw new Error(`${file} has DT_NEEDED entries but no DT_STRTAB`);
  }

  const load = loads.find((s) => strtabAddr >= s.vaddr && strtabAddr < s.vaddr + s.filesz);

  if (!load) {
    throw new Error(`${file} has a DT_STRTAB outside every PT_LOAD segment`);
  }

  const strtab = Number(load.offset + (strtabAddr - load.vaddr));

  return needed.map((value) => {
    const start = strtab + Number(value);

    return buf.toString("latin1", start, buf.indexOf(0, start));
  });
};

/**
 * The symbols an ELF64 little-endian file exports to the dynamic linker: each .dynsym entry that is
 * defined in the file, global, weak or unique, and of default or protected visibility, as
 * `nm -D --defined-only` lists them. Strip keeps .dynsym.
 * Throws `${file} is not an ELF64 file`.
 */
export const exportedSymbols = (file: string): string[] => {
  const buf = readElf64(file);

  const shoff = Number(buf.readBigUInt64LE(40));
  const shentsize = buf.readUInt16LE(58);
  const shnum = buf.readUInt16LE(60);

  const section = (index: number): Section => {
    const at = shoff + index * shentsize;

    return {
      type: buf.readUInt32LE(at + 4),
      offset: Number(buf.readBigUInt64LE(at + 24)),
      size: Number(buf.readBigUInt64LE(at + 32)),
      link: buf.readUInt32LE(at + 40),
    };
  };

  if (shoff === 0 || shentsize < SHDR_SIZE) {
    return [];
  }

  const dynsym = Array.from({ length: shnum }, (_, index) => section(index)).find(
    (header) => header.type === SHT_DYNSYM
  );

  if (!dynsym) {
    return [];
  }

  const strtab = section(dynsym.link).offset;
  const symbols: string[] = [];

  for (let at = dynsym.offset; at + SYM_SIZE <= dynsym.offset + dynsym.size; at += SYM_SIZE) {
    const name = buf.readUInt32LE(at);
    // st_info: binding in the high nibble; st_other: visibility in the low two bits
    const binding = Math.floor(buf.readUInt8(at + 4) / 16);
    const visibility = buf.readUInt8(at + 5) % 4;
    const shndx = buf.readUInt16LE(at + 6);

    const exported =
      name !== 0 &&
      shndx !== SHN_UNDEF &&
      (binding === STB_GLOBAL || binding === STB_WEAK || binding === STB_GNU_UNIQUE) &&
      (visibility === STV_DEFAULT || visibility === STV_PROTECTED);

    if (exported) {
      const start = strtab + name;
      symbols.push(buf.toString("latin1", start, buf.indexOf(0, start)));
    }
  }

  return symbols;
};
