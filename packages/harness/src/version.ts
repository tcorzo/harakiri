export type Version = readonly [major: number, minor: number, patch: number];

/** Reads the first dotted version after `prefix` (e.g. "mpv v0.41.0" with /mpv v?/). */
export function parseVersion(text: string, prefix: RegExp): Version | null {
  const found = new RegExp(`${prefix.source}(\\d+)(?:\\.(\\d+))?(?:\\.(\\d+))?`, prefix.flags).exec(
    text
  );
  if (found === null) return null;
  const [, major = "0", minor = "0", patch = "0"] = found;
  return [Number(major), Number(minor), Number(patch)];
}

export function compareVersions(a: Version, b: Version): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

export function formatVersion(v: Version): string {
  return v.join(".");
}
