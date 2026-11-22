import { readFileSync } from "node:fs";

const PT_LOAD = 1;
const PT_DYNAMIC = 2;
const DT_NULL = 0n;
const DT_NEEDED = 1n;
const DT_STRTAB = 5n;

interface Segment {
  offset: bigint;
  vaddr: bigint;
  filesz: bigint;
}

/** The DT_NEEDED sonames of an ELF64 little-endian file, in file order. Throws `${file} is not an ELF64 file`. */
export const neededLibs = (file: string): string[] => {
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
