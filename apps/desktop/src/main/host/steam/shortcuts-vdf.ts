import { readFile } from "node:fs/promises";

import { getLogger } from "@logtape/logtape";
import { match } from "ts-pattern";

const logger = getLogger(["harakiri", "host", "steam"]);

export interface Shortcut {
  /** Unsigned 32-bit, as the `grid/` file names use it. */
  readonly appId: number;
  readonly appName: string;
  /** As Steam stored it, quotes included. */
  readonly exe: string;
}

export class VdfError extends Error {
  override readonly name = "VdfError";
}

const TYPE_NESTED = 0x00;
const TYPE_STRING = 0x01;
const TYPE_INT = 0x02;
const TYPE_END = 0x08;

/**
 * Value types harakiri does not read, by their width in bytes: float32 (0x03), pointer (0x04),
 * color (0x06), uint64 (0x07) and int64 (0x0a), as ValvePython/vdf's `binary_loads` reads them.
 * A field of one is skipped, so a type Steam adds to an entry does not hide every shortcut.
 */
const SKIPPED_WIDTHS: ReadonlyMap<number, number> = new Map([
  [0x03, 4],
  [0x04, 4],
  [0x06, 4],
  [0x07, 8],
  [0x0a, 8],
]);

type VdfValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "object"; readonly fields: VdfObject };

type VdfObject = Map<string, VdfValue>;

/** A cursor over the bytes. Every read checks its bounds. */
interface Cursor {
  readonly byte: () => number;
  readonly uint32: () => number;
  readonly cstring: () => string;
  readonly skip: (bytes: number) => void;
}

const cursorOver = (buffer: Buffer): Cursor => {
  let offset = 0;

  return {
    byte: () => {
      const value = buffer[offset];

      if (value === undefined) {
        throw new VdfError(`truncated at byte ${offset}`);
      }

      offset += 1;

      return value;
    },
    uint32: () => {
      if (offset + 4 > buffer.length) {
        throw new VdfError(`truncated integer at byte ${offset}`);
      }

      const value = buffer.readUInt32LE(offset);
      offset += 4;

      return value;
    },
    cstring: () => {
      const end = buffer.indexOf(0, offset);

      if (end === -1) {
        throw new VdfError(`unterminated string at byte ${offset}`);
      }

      const value = buffer.toString("utf-8", offset, end);
      offset = end + 1;

      return value;
    },
    skip: (bytes) => {
      if (offset + bytes > buffer.length) {
        throw new VdfError(`truncated value at byte ${offset}`);
      }

      offset += bytes;
    },
  };
};

const readObject = (cursor: Cursor): VdfObject => {
  const fields: VdfObject = new Map();

  for (;;) {
    const type = cursor.byte();

    if (type === TYPE_END) {
      return fields;
    }

    const name = cursor.cstring();
    const skipped = SKIPPED_WIDTHS.get(type);

    if (skipped === undefined) {
      const value = match<number, VdfValue>(type)
        .with(TYPE_NESTED, () => ({ kind: "object", fields: readObject(cursor) }))
        .with(TYPE_STRING, () => ({ kind: "string", value: cursor.cstring() }))
        .with(TYPE_INT, () => ({ kind: "int", value: cursor.uint32() }))
        .otherwise(() => {
          throw new VdfError(`unknown type byte 0x${type.toString(16)} for "${name}"`);
        });

      fields.set(name, value);
    } else {
      cursor.skip(skipped);
    }
  }
};

const lookup = (fields: VdfObject, key: string): VdfValue | undefined => {
  for (const [name, value] of fields) {
    if (name.toLowerCase() === key) {
      return value;
    }
  }

  return undefined;
};

const toShortcut = (fields: VdfObject): Shortcut | undefined => {
  const appId = lookup(fields, "appid");
  const exe = lookup(fields, "exe");

  if (appId?.kind !== "int" || exe?.kind !== "string") {
    return undefined;
  }

  const appName = lookup(fields, "appname");

  return {
    appId: appId.value,
    appName: appName?.kind === "string" ? appName.value : "",
    exe: exe.value,
  };
};

/** Throws VdfError on a truncated buffer, an unknown type byte, or a root that is not "shortcuts". */
export const parseShortcuts = (bytes: Uint8Array): Shortcut[] => {
  if (bytes.length === 0) {
    return [];
  }

  const cursor = cursorOver(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const rootType = cursor.byte();
  const rootName = rootType === TYPE_NESTED ? cursor.cstring() : "";

  if (rootName.toLowerCase() !== "shortcuts") {
    throw new VdfError('the root is not "shortcuts"');
  }

  const shortcuts: Shortcut[] = [];

  for (const entry of readObject(cursor).values()) {
    const shortcut = entry.kind === "object" ? toShortcut(entry.fields) : undefined;

    if (shortcut) {
      shortcuts.push(shortcut);
    }
  }

  return shortcuts;
};

/** ENOENT gives []. A VdfError gives [] plus one warning naming the file. Other IO errors reject. */
export const readShortcuts = async (file: string): Promise<Shortcut[]> => {
  let bytes: Uint8Array;

  try {
    bytes = await readFile(file);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  try {
    return parseShortcuts(bytes);
  } catch (error) {
    if (error instanceof VdfError) {
      logger.warn("Steam's shortcuts file {file} could not be read: {reason}", {
        file,
        reason: error.message,
      });

      return [];
    }

    throw error;
  }
};

/** Strips one pair of surrounding double quotes. */
export const unquoteExe = (exe: string): string =>
  exe.length >= 2 && exe.startsWith('"') && exe.endsWith('"') ? exe.slice(1, -1) : exe;

export const shortcutFor = (shortcuts: readonly Shortcut[], script: string): Shortcut | undefined =>
  shortcuts.find((shortcut) => unquoteExe(shortcut.exe) === script);
