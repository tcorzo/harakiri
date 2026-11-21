export {
  buildPlaybackArgs,
  configArg,
  PRD_PASSTHROUGH,
  type AudioPassthrough,
  type Hwdec,
  type MpvConfig,
  type PlaybackConfig,
  type SpdifCodec,
} from "./args";

export {
  MpvClosedError,
  MpvCommandError,
  MpvStartError,
  MpvTimeoutError,
  spawnMpv,
  type JsonValue,
  type MpvClient,
  type MpvEvent,
  type MpvExit,
  type MpvSpawnOptions,
  type Unsubscribe,
} from "./client";

export { setHttpHeaders, type HttpHeaders } from "./http";
