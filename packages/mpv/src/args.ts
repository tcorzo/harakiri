/**
 * mpv's `--audio-spdif` tokens. `dts-hd` passes DTS-HD whole and still sends plain DTS as DTS;
 * plain `dts` sends DTS-HD as its lossy core, so it is only for an output that takes DTS alone.
 */
export type SpdifCodec = "ac3" | "eac3" | "dts" | "dts-hd" | "truehd";

/** The PRD's passthrough list: every compressed format a receiver decodes itself. */
export const PRD_PASSTHROUGH = ["ac3", "eac3", "dts-hd", "truehd"] as const satisfies readonly [
  SpdifCodec,
  ...SpdifCodec[],
];

export type AudioPassthrough = readonly [SpdifCodec, ...SpdifCodec[]] | "none";

export type Hwdec =
  | "no"
  | "auto"
  | "auto-safe"
  | "auto-copy"
  | "vaapi"
  | "nvdec"
  | "vulkan"
  | "d3d11va"
  | "videotoolbox";

/**
 * Everything here ends up in mpv's argv, which any local user can read from
 * `/proc/<pid>/cmdline`. Secrets (the Jellyfin token, `ApiKey=` URLs) go over IPC instead:
 * see `setHttpHeaders`.
 */
export interface PlaybackConfig {
  /** Default `auto`: mpv signals the source colorspace to the compositor when it supports it. */
  readonly colorspaceHint?: "auto" | "yes" | "no";
  /** Default `auto-safe`. */
  readonly hwdec?: Hwdec;
  /** Codecs the receiver decodes itself, sent as bitstream. Default `PRD_PASSTHROUGH`. */
  readonly audioPassthrough?: AudioPassthrough;
  /** An `audio-device-list` name. Omitted means mpv picks. */
  readonly audioDevice?: string;
  /** Default `true`. */
  readonly fullscreen?: boolean;
  /** Default `true`. */
  readonly gamepad?: boolean;
}

type MpvOption = readonly [name: string, value: string];

const flag = (on: boolean) => (on ? "yes" : "no");

export function buildPlaybackArgs(config: PlaybackConfig = {}): string[] {
  const passthrough = config.audioPassthrough ?? PRD_PASSTHROUGH;
  const options: MpvOption[] = [
    ["vo", "gpu-next"],
    ["gpu-api", "vulkan"],
    ["target-colorspace-hint", config.colorspaceHint ?? "auto"],
    ["hwdec", config.hwdec ?? "auto-safe"],
    ["fullscreen", flag(config.fullscreen ?? true)],
    ["input-gamepad", flag(config.gamepad ?? true)],
    // After a failed load, the ytdl hook starts yt-dlp with the URL, `api_key=` and all, in argv.
    ["ytdl", "no"],
  ];
  if (passthrough !== "none") options.push(["audio-spdif", [...new Set(passthrough)].join(",")]);
  if (config.audioDevice !== undefined) options.push(["audio-device", config.audioDevice]);
  return options.map(([name, value]) => `--${name}=${value}`);
}

/**
 * Where mpv reads its config. The shipped player always passes an app-owned dir, so a personal
 * `mpv.conf` cannot change the validated path; `none` (`--no-config`) is for tests and the harness.
 */
export type MpvConfig = { readonly dir: string } | "none";

export const configArg = (config: MpvConfig): string =>
  config === "none" ? "--no-config" : `--config-dir=${config.dir}`;
