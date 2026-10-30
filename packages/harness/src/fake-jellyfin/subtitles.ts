import type { MediaStream } from "./probe";

/**
 * How Jellyfin delivers each subtitle stream, ported from StreamBuilder.GetSubtitleProfile, and
 * which one it turns on by default (MediaStreamSelector, SubtitleMode "Default" with no language
 * preference, the dev user's settings). VobSub-in-MKS profiles are left out: the corpus has none.
 */

export interface SubtitleProfile {
  readonly Format?: string | null;
  readonly Method?: string | null;
  readonly Container?: string | null;
}

export interface Delivery {
  readonly method: "Embed" | "External" | "Encode";
  readonly format: string;
}

const lower = (text: string | null | undefined) => (text ?? "").toLowerCase();

/** MediaStream.IsTextFormat. */
export function isTextFormat(format: string): boolean {
  const codec = lower(format);
  return (
    codec.includes("microdvd") ||
    (!codec.includes("pgs") &&
      !codec.includes("dvdsub") &&
      !codec.includes("dvbsub") &&
      codec !== "sup" &&
      codec !== "sub")
  );
}

/** MediaStream.SupportsSubtitleConversionTo. */
function convertible(stream: MediaStream, to: string): boolean {
  const from = lower(stream.Codec);
  if (stream["IsTextSubtitleStream"] !== true) return false;
  if (from === "ass" || from === "ssa" || lower(to) === "ass" || lower(to) === "ssa") return false;
  return true;
}

const inList = (list: string | null | undefined, value: string) =>
  list == null || list === "" || list.split(",").some((c) => lower(c) === lower(value));

export function deliver(
  stream: MediaStream,
  profiles: readonly SubtitleProfile[],
  transcodingHls: boolean,
  outputContainer: string,
): Delivery {
  const text = stream["IsTextSubtitleStream"] === true;
  // Over HLS every subtitle leaves as a sidecar; direct play may keep embedded ones in the file.
  if (!stream.IsExternal && !transcodingHls) {
    const embeddable = profiles.filter(
      (p) => p.Method === "Embed" && inList(p.Container, outputContainer),
    );
    const same = embeddable.find(
      (p) => text === isTextFormat(p.Format ?? "") && lower(p.Format) === lower(stream.Codec),
    );
    const converted = same ?? embeddable.find((p) => text && convertible(stream, p.Format ?? ""));
    if (converted) return { method: "Embed", format: converted.Format ?? "" };
  }
  for (const allowConversion of [false, true]) {
    for (const p of profiles) {
      if (p.Method !== "External") continue;
      if (text !== isTextFormat(p.Format ?? "")) continue;
      if (lower(p.Format) === lower(stream.Codec))
        return { method: "External", format: p.Format ?? "" };
      if (
        allowConversion &&
        stream["SupportsExternalStream"] === true &&
        convertible(stream, p.Format ?? "")
      )
        return { method: "External", format: p.Format ?? "" };
    }
  }
  return { method: "Encode", format: stream.Codec };
}

/** MediaStreamSelector.GetDefaultSubtitleStreamIndex in Default mode: sidecars first. */
export function defaultSubtitleIndex(streams: readonly MediaStream[]): number | undefined {
  const flag = (s: MediaStream, key: string) => (s[key] === true ? 1 : 0);
  const sorted = streams
    .filter((s) => s.Type === "Subtitle")
    .toSorted(
      (a, b) =>
        flag(b, "IsExternal") - flag(a, "IsExternal") ||
        flag(b, "IsDefault") - flag(a, "IsDefault") ||
        flag(b, "IsForced") - flag(a, "IsForced"),
    );
  return sorted.find((s) => s.IsExternal || s["IsDefault"] === true || s["IsForced"] === true)
    ?.Index;
}
