/** Encodes Steam's binary `shortcuts.vdf`, for the tests and the e2e that need one. */
export interface ShortcutEntry {
  /** Written as `appId >>> 0`, so a negative int32 and its unsigned value encode alike. */
  readonly appId: number;
  readonly appName: string;
  readonly exe: string;
  /** "steam": appid/AppName/Exe (default). "lower": appid/appname/exe, as other tools write. */
  readonly keys?: "steam" | "lower";
}

const END = 0x08;
const NESTED = 0x00;
const STRING = 0x01;
const INT = 0x02;

const cstring = (value: string): Buffer =>
  Buffer.concat([Buffer.from(value, "utf-8"), Buffer.alloc(1)]);

const stringField = (name: string, value: string): Buffer =>
  Buffer.concat([Buffer.from([STRING]), cstring(name), cstring(value)]);

const intField = (name: string, value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  // oxlint-disable-next-line no-bitwise -- the wire format is unsigned; this is the int32 to uint32 cast
  bytes.writeUInt32LE(value >>> 0);

  return Buffer.concat([Buffer.from([INT]), cstring(name), bytes]);
};

const encodeEntry = (entry: ShortcutEntry, index: number): Buffer => {
  const lower = entry.keys === "lower";

  return Buffer.concat([
    Buffer.from([NESTED]),
    cstring(String(index)),
    intField("appid", entry.appId),
    stringField(lower ? "appname" : "AppName", entry.appName),
    stringField(lower ? "exe" : "Exe", entry.exe),
    stringField("StartDir", ""),
    stringField("icon", ""),
    stringField("ShortcutPath", ""),
    stringField("LaunchOptions", ""),
    intField("IsHidden", 0),
    intField("AllowDesktopConfig", 1),
    intField("AllowOverlay", 1),
    intField("OpenVR", 0),
    intField("Devkit", 0),
    stringField("DevkitGameID", ""),
    intField("DevkitOverrideAppID", 0),
    intField("LastPlayTime", 0),
    stringField("FlatpakAppID", ""),
    Buffer.from([NESTED]),
    cstring("tags"),
    stringField("0", "favorite"),
    Buffer.from([END]),
    Buffer.from([END]),
  ]);
};

export const encodeShortcuts = (entries: readonly ShortcutEntry[]): Uint8Array =>
  new Uint8Array(
    Buffer.concat([
      Buffer.from([NESTED]),
      cstring("shortcuts"),
      ...entries.map((entry, index) => encodeEntry(entry, index)),
      Buffer.from([END, END]),
    ])
  );
