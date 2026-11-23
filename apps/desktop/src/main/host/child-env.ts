/** Variables that change which libraries a child loads, whatever its own RUNPATH says. */
const LOADER_VARIABLES = new Set(["LD_LIBRARY_PATH", "LD_PRELOAD"]);

/**
 * The environment for harakiri's own mpv: `env` without the loader's search overrides. An AppImage's
 * AppRun and Steam's runtime both put their library dirs in `LD_LIBRARY_PATH`, and the loader
 * searches that before the bundle's `$ORIGIN/lib` RUNPATH, so an older SDL2 there would replace
 * the bundle's own. Undefined values are dropped (`process.env` types them so).
 */
export const bundledMpvEnv = (env: Readonly<Record<string, string | undefined>>) =>
  Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !LOADER_VARIABLES.has(entry[0])
    )
  );

/**
 * The environment for a tool of the host's own that harakiri runs (`pactl`, say): `env` without
 * the loader's search overrides, as for `bundledMpvEnv`. Under an AppImage or Steam,
 * `LD_LIBRARY_PATH` can hand the host's `pactl` an older `libpulse` that fails, and the sink would
 * read as unknown. Undefined values are dropped.
 */
export const hostToolEnv = (env: Readonly<Record<string, string | undefined>>) =>
  bundledMpvEnv(env);

/**
 * The env for the mpv a play runs: the developer's own mpv (`HARAKIRI_MPV` set) gets the
 * environment as it is, with the libraries it was built to find; harakiri's build gets
 * `bundledMpvEnv`.
 */
export const mpvChildEnv = (
  override: string | undefined,
  env: Readonly<Record<string, string | undefined>>
) =>
  override === undefined
    ? bundledMpvEnv(env)
    : Object.fromEntries(
        Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
      );
