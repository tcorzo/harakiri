# 04 — Jellyfin integration and the "never transcode" guarantee

Research date: 2026-10-29. Read-only. Server sources are from `jellyfin/jellyfin` default branch (12.4 era), fetched with `gh api repos/jellyfin/jellyfin/contents/<path> -H 'Accept: application/vnd.github.raw'`. Local copies were kept in the research scratchpad (not committed).

## 0. TL;DR

- **Root cause of the trigger, found.** Jellyfin Desktop builds its profile in `native/nativeshell.js`. When the setting `force_transcode_dovi` is on, it adds a CodecProfile with the condition `VideoRangeType NotEquals DOVI`. In `resources/settings/settings_description.json` that setting is `"default": true`. DV Profile 5 has no fallback base layer, so the server classifies it as the bare `DOVI` range type. The condition then fails, and the server returns `VideoRangeTypeNotSupported`. Profiles 7 and 8 classify as `DOVIWithHDR10`, `DOVIWithHLG`, `DOVIWithSDR` or `DOVIWithEL*`, so they pass that condition. That explains why only P5 broke. jellyfin-mpv-shim has the same `transcode_dolby_vision` switch (`jellyfin_mpv_shim/utils.py`, around line 408).
  - Source: `gh api repos/jellyfin/jellyfin-desktop/contents/native/nativeshell.js` and `.../resources/settings/settings_description.json`.
- **The most permissive profile has no conditions at all.** Use `CodecProfiles: []` and `DirectPlayProfiles: [{ Type: 'Video' }, { Type: 'Audio' }]`, with an empty Container and empty codecs. `ContainerHelper.ContainsContainer` treats an empty value as "accept all". In `ConditionProcessor.IsConditionSatisfied(VideoRangeType)`, a range type is rejected only when a condition exists, so with no condition every range type, past or future, passes. You do not need to list DOVI, DOVIWithHDR10 and the rest. Listing them is how clients get it wrong.
- **Bitrate is the other trap.** `DeviceProfile.MaxStreamingBitrate` and `MaxStaticBitrate` default to **8 000 000** on the server when you omit them (`DeviceProfile.cs`). When the file bitrate is unknown, the server assumes **40 Mbps** (`StreamBuilder.IsBitrateLimitExceeded`). Always send `MaxStreamingBitrate` in both the profile and the `PlaybackInfoDto`.
- **Client library: generate our own with `@hey-api/openapi-ts` + `@hey-api/client-ky`** from a vendored copy of `https://api.jellyfin.org/openapi/jellyfin-openapi-stable.json`. Keep `@jellyfin/sdk` as a reference, not as a dependency. Reasons are in §1.
- **`TranscodeReasons` is not on the `MediaSourceInfo` DTO** (checked against spec 12.4.0). The reasons appear only as a query parameter inside `TranscodingUrl`. The tests therefore assert `SupportsDirectPlay === true && !TranscodingUrl`.
- **Integration tier is feasible locally.** Both podman 5.8.9 and docker 29.8.2 are installed (`which podman docker`). The image is `jellyfin/jellyfin:12.4` (Docker Hub, updated 2026-10-26). Headless setup through the Startup API has well-tested prior art (§4).

## 1. Client library

### 1.1 `@jellyfin/sdk`

| Fact                 | Value                                                                                                                                                             | Backed by                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Latest               | 1.0.2, published 2026-10-23T12:07Z; `unstable` = `0.0.0-unstable.202610291827` (nightly)                                                                          | `curl -s https://registry.npmjs.org/@jellyfin/sdk`                                                                  |
| Server compatibility | SDK 1.0.x → Jellyfin 12.x; 0.13/0.12 → 10.11; 0.11 → 10.10                                                                                                        | SDK README "Supported Jellyfin Versions" table (`gh api repos/jellyfin/jellyfin-sdk-typescript/contents/README.md`) |
| Generator            | OpenAPI Generator CLI 7.20.0, `typescript-axios`, `useSingleRequestParameter`, `withSeparateModelsAndApi`                                                         | `openapitools.json` in the repo                                                                                     |
| Transport            | **axios, as a peer dependency** (`axios ^1.12.0`); axios latest is 1.21.0                                                                                         | `package.json`; `curl -s https://registry.npmjs.org/axios`                                                          |
| Schema handling      | `scripts/modify-schema.mjs` flattens single-element `allOf`, which **drops nullability and descriptions**                                                         | file in the repo                                                                                                    |
| Spec refresh         | Nightly cron curls `api.jellyfin.org/openapi/jellyfin-openapi-stable.json` and opens a PR                                                                         | `.github/workflows/sdk-update-api-spec.yaml`                                                                        |
| Packaging            | ESM (`"type":"module"`), `main` plus `typings`, **no `exports` map and no `sideEffects` field**, 711 files (one module per API and model)                         | npm metadata; `unpkg.com/@jellyfin/sdk@1.0.2/?meta`                                                                 |
| Tree-shaking         | Per-API classes (`getItemsApi(api)` etc.) shake well under Rollup/Vite in practice. Without a `sideEffects:false` flag, shaking depends on the bundler's analysis | `unverified` (not measured)                                                                                         |
| Built with           | TypeScript 6.0.3; tests on Vitest 4.1.10                                                                                                                          | `package.json`                                                                                                      |
| TS 7 compatibility   | TS latest is 7.0.2. Consuming the SDK's `.d.ts` from TS 7 should work, but nobody upstream has stated it                                                          | `curl -s https://registry.npmjs.org/typescript`; `unverified`                                                       |
| Maintenance          | Last push 2026-10-29; 23 open issues; 128 stars; not archived; releases 1.0.0 (2026-09-11), 1.0.1 (10-16), 1.0.2 (10-23)                                          | `gh api repos/jellyfin/jellyfin-sdk-typescript` and `.../releases`                                                  |
| Integration tests    | Run against a secret, externally hosted server, weekly. Not containerised, so there is nothing to reuse                                                           | `.github/workflows/test-integration.yaml`                                                                           |

### 1.2 Generating our own

- **Spec location.** `https://api.jellyfin.org/openapi/jellyfin-openapi-stable.json` (HTTP 200, 1.9 MB). There are also `-stable_previous`, `-unstable` and `-unstable_previous` variants (`curl -s https://api.jellyfin.org/openapi/`). The current stable is OpenAPI **3.0.4** with `info.version` **12.4.0**: 346 operations and 357 schemas. A running server also serves its own spec at `/api-docs/openapi.json` (`unverified` for 12.x, but this is long-standing Swashbuckle behaviour).
- **Auth.** The spec declares a single security scheme, `CustomAuthentication`: apiKey, header `Authorization`. The header value is `MediaBrowser Client="…", Device="…", DeviceId="…", Version="…", Token="…"`. From v12, the `api_key` query parameter is gated behind `EnableLegacyAuthorization`, which is off by default. Use the `ApiKey` query parameter or the header instead (jellyfin-mpv-shim `docs/jellyfin-api-notes.md` §11, which cites `AuthorizationContext.GetAuthorizationInfoFromDictionary`).
- **Stability.** The enum and schema set changes between majors. For example, `VideoRangeType` gained `DOVIWithEL`, `DOVIWithHDR10Plus`, `DOVIWithELHDR10Plus` and `DOVIInvalid` in 10.11; 10.10.7 has only 9 values (`gh api 'repos/jellyfin/jellyfin/contents/Jellyfin.Data/Enums/VideoRangeType.cs?ref=v10.10.7'`). Within a major, the upstream SDK's nightly spec PRs suggest the changes are mostly additive (`unverified`).
- **hey-api.** `@hey-api/openapi-ts` latest is 0.99.0 (2026-06-22), with a `next` tag from 2026-09-30 (npm registry). It is still pre-1.0, so pin it exactly. The ky client ships as the built-in plugin `@hey-api/client-ky`; there is no separate npm package (`npx ctx7 docs /websites/heyapi_dev`, heyapi.dev/docs/openapi/typescript/clients/ky). The `zod` and `@tanstack/react-query` plugins exist (same docs). Whether its operation filtering can trim the 346 operations down to the roughly 30 we need is `unverified`. Even without filtering, output is per-operation functions, so it tree-shakes.

### 1.3 Recommendation

Generate our own client. Vendor `jellyfin-openapi-stable.json` into the repo with its version in the filename, and regenerate on purpose when we bump it.

- Reasons:
  - It matches the house stack (ky, zod, TanStack Query).
  - It keeps axios out of the bundle.
  - The zod plugin gives validation at the IO edge for free.
  - We keep the real nullability, which the SDK's `allOf` flattening throws away.
  - The SDK adds little beyond the generated code: discovery helpers and `getXApi` wrappers.
- Things to borrow from the SDK by reading it:
  - server discovery and address-candidate logic (`src/discovery`, `utils/address-candidates`)
  - the `MINIMUM_VERSION` / `API_VERSION` constants
- Caveat: hey-api is pre-1.0, so expect churn in generator config across minor versions.

## 2. DeviceProfile design

### 2.1 Shape (spec 12.4.0 / `MediaBrowser.Model/Dlna/DeviceProfile.cs`)

`DeviceProfile { Name, Id, MaxStreamingBitrate (default 8e6), MaxStaticBitrate (default 8e6), MusicStreamingTranscodingBitrate (128k), MaxStaticMusicBitrate (8e6), DirectPlayProfiles[], TranscodingProfiles[], ContainerProfiles[], CodecProfiles[], SubtitleProfiles[] }`

- `DirectPlayProfile { Container, AudioCodec, VideoCodec, Type }`. Each field is a comma list; empty means any.
- `CodecProfile { Type, Conditions[], ApplyConditions[], Codec, Container, SubContainer }`
- `ProfileCondition { Condition (Equals|NotEquals|LessThanEqual|GreaterThanEqual|EqualsAny), Property, Value, IsRequired }`. For `EqualsAny`, `Value` is a `|`-separated list.
- `ProfileConditionValue` includes `VideoRangeType = 24`, `VideoCodecTag`, `NumStreams`, `VideoRotation` and others (`MediaBrowser.Model/Dlna/ProfileConditionValue.cs`).
- `SubtitleProfile { Format, Method (Encode|Embed|External|Hls|Drop), DidlMode, Language, Container }`
- `TranscodingProfile { Container, Type, VideoCodec, AudioCodec, Protocol, …, MaxAudioChannels, Conditions }`

### 2.2 VideoRangeType (current server, `Jellyfin.Data/Enums/VideoRangeType.cs`)

`Unknown, SDR, HDR10, HLG, DOVI, DOVIWithHDR10, DOVIWithHLG, DOVIWithSDR, DOVIWithEL, DOVIWithHDR10Plus, DOVIWithELHDR10Plus, DOVIInvalid, HDR10Plus`

The spec enum matches. History: 10.10.7 lacks `DOVIWithEL`, `DOVIWithHDR10Plus`, `DOVIWithELHDR10Plus` and `DOVIInvalid`. Those arrived with "Improve dynamic HDR metadata handling (#13277)", committed 2025-04-03 and released in 10.11 (`gh api 'repos/jellyfin/jellyfin/commits?path=Jellyfin.Data/Enums/VideoRangeType.cs'`).

Rough mapping, `unverified` beyond the enum names. The classification lives in the server's MediaStream/ffprobe code, which I did not read.

| Range type          | Typical source                                |
| ------------------- | --------------------------------------------- |
| DOVI                | Profile 5 (IPT-PQ-c2, no base-layer fallback) |
| DOVIWithHDR10       | Profile 8.1, or Profile 7 with MEL stripped   |
| DOVIWithHLG         | Profile 8.4                                   |
| DOVIWithSDR         | Profile 8.2 / 9                               |
| DOVIWithEL          | Profile 7 with FEL/MEL                        |
| DOVIWithHDR10Plus   | P8.1 that also carries HDR10+                 |
| DOVIWithELHDR10Plus | P7 with HDR10+                                |
| DOVIInvalid         | Broken or unknown RPU                         |

How the server evaluates it (`MediaBrowser.Model/Dlna/ConditionProcessor.cs`, `IsConditionSatisfied(ProfileCondition, VideoRangeType?)`):

- `Unknown` or null satisfies a condition unless `IsRequired` is set.
- `HDR10Plus` also satisfies anything that accepts `HDR10`.
- `EqualsAny` splits on `|` and uses `Enum.TryParse`. Names the server does not know are skipped silently, so sending 10.11+ names to 10.10 does no harm.
- **No CodecProfile means no evaluation.**

### 2.3 How other clients do it

| Client                                                                                             | Approach                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | DV P5 outcome                                                |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| jellyfin-web `src/scripts/browserDeviceProfile.js` (l.1232-1360)                                   | Builds per-codec `EqualsAny` `VideoRangeType` lists (h264: SDR only; hevc/av1: adds HDR10, HDR10Plus, HLG, and DOVI\* only when `supportsDolbyVision()`). It strips DOVI\* for some webOS versions (l.1545)                                                                                                                                                                                                                                                                   | Rejected on most desktops, because browsers cannot decode DV |
| jellyfin-desktop `native/nativeshell.js` `getDeviceProfile()`                                      | `DirectPlayProfiles: [{Type:'Audio'},{Type:'Photo'},{Type:'Video'}]` (wildcards), `CodecProfiles` empty **except** opt-in force-transcode switches; `force_transcode_dovi` → `NotEquals DOVI`, **default true**; `MaxStaticBitrate: 1e9`; no `MaxStreamingBitrate` (server default is 8e6, see §5)                                                                                                                                                                            | **Rejected by default.** This is the trigger                 |
| jellyfin-mpv-shim `jellyfin_mpv_shim/utils.py:get_profile` (v3.3.0, 2026-10-23)                    | Wildcard DirectPlay; `CodecProfiles: []` plus opt-in `transcode_dolby_vision` (NotEquals DOVI), `transcode_hdr` (Equals SDR), `transcode_hi10p`, etc. `MaxStreamingBitrate`/`MaxStaticBitrate` = user kbps setting. Enumerates SubtitleProfiles (srt/ass/ssa/sub/smi Embed+External; pgssub Embed+External; dvdsub/dvbsub/pgs Embed; `{dvdsub, External, Container:'mks'}` on 12+)                                                                                            | Plays if the setting is off                                  |
| Jellium (`andrewrabert/jellium-desktop`, Rust, 1875★, pushed 2026-10-27) `src/jellyfin/src/lib.rs` | **Derives the profile from mpv's real demuxer/decoder lists**: one DirectPlay entry with every container comma-joined, plus the video and audio codec CSVs; Embed+External SubtitleProfile per mpv subtitle decoder, with renames (`hdmv_pgs_subtitle→PGSSUB`, `dvd_subtitle→DVDSUB`, `subrip→srt`, `matroska→mkv`, `mpegts→ts`); no CodecProfiles; `MaxStaticBitrate 1e9`; TranscodingProfile codec CSVs kept under the server's 40-char query validator (`^[a-zA-Z0-9\-\._, | ]{0,40}$`)                                                   | Plays (no range conditions) |

Note on Jellium: enumerating codecs is more "honest" than a wildcard, but it can cause a transcode for an exotic codec that mpv supports under a different name than ffprobe reports. Since mpv and Jellyfin both use FFmpeg names, the risk is small. It is still a reason to prefer wildcards.

### 2.4 Draft profile (TypeScript)

```ts
// Harakiri "mpv plays everything" profile. Deliberately has NO CodecProfiles:
// any VideoRangeType condition is a way to reintroduce the DV P5 bug.
const MAX_BITRATE = 1_000_000_000; // int32-safe; matches Jellium/Jellyfin Desktop MaxStaticBitrate

const TEXT_SUBS = [
  "srt",
  "subrip",
  "ass",
  "ssa",
  "vtt",
  "webvtt",
  "mov_text",
  "ttml",
  "smi",
  "sami",
  "sub",
  "microdvd",
];
const IMAGE_SUBS = ["pgssub", "pgs", "dvdsub", "vobsub", "dvbsub"];

export const harakiriDeviceProfile = {
  Name: "Harakiri",
  MaxStreamingBitrate: MAX_BITRATE,
  MaxStaticBitrate: MAX_BITRATE,
  MaxStaticMusicBitrate: MAX_BITRATE,
  MusicStreamingTranscodingBitrate: 1_280_000,
  DirectPlayProfiles: [
    { Type: "Video" }, // empty Container/VideoCodec/AudioCodec = accept all (ContainerHelper)
    { Type: "Audio" },
    { Type: "Photo" },
  ],
  ContainerProfiles: [],
  CodecProfiles: [], // never add VideoRangeType / VideoBitDepth / Width conditions
  SubtitleProfiles: [
    ...[...TEXT_SUBS, ...IMAGE_SUBS].map((Format) => ({ Format, Method: "Embed" as const })),
    ...TEXT_SUBS.map((Format) => ({ Format, Method: "External" as const })),
    { Format: "pgssub", Method: "External" as const }, // raw PGS sidecar served since 10.10
    { Format: "dvdsub", Method: "External" as const, Container: "mks" }, // VobSub .mks; send only to server >= 12.0
  ],
  // Fallback only. Keep it so the server can still hand back *something* if
  // the user's policy or a remote bitrate cap forces it, but the app treats any
  // non-DirectPlay answer as a failure to surface, not to silently play.
  TranscodingProfiles: [
    {
      Type: "Video",
      Container: "mp4",
      Protocol: "hls",
      VideoCodec: "hevc,h264,av1",
      AudioCodec: "eac3,ac3,aac,flac,opus",
      MaxAudioChannels: "8",
    },
    { Type: "Audio", Container: "flac", Protocol: "http", AudioCodec: "flac" },
  ],
} satisfies DeviceProfile; // DeviceProfile type from the generated client
```

The PlaybackInfo request body (`POST /Items/{itemId}/PlaybackInfo`, `PlaybackInfoDto`):

```ts
{
  UserId, DeviceProfile: harakiriDeviceProfile,
  MaxStreamingBitrate: MAX_BITRATE,           // request value wins over profile (MediaOptions.GetMaxBitrate)
  EnableDirectPlay: true, EnableDirectStream: true, EnableTranscoding: true,
  AllowVideoStreamCopy: true, AllowAudioStreamCopy: true,
  MediaSourceId,                              // required for AudioStreamIndex to be honoured (mpv-shim notes §11)
  AudioStreamIndex,                           // omit unless user picked; never pick an external audio track (AudioIsExternal)
  SubtitleStreamIndex: -1,                    // let mpv select subs itself; avoids SubtitleCodecNotSupported
  AutoOpenLiveStream: true,
}
```

Open question: whether `EnableTranscoding: false` should be the strict mode. It turns the guarantee into a hard failure rather than a fallback: the server then returns a source with `SupportsDirectPlay` false and `SupportsTranscoding` false. That is a product decision. I recommend a "strict" toggle that defaults on, with a clear UI error that shows the decoded `TranscodeReasons`.

## 3. Direct play, streaming, reporting

- **Server-side direct play decision** (`StreamBuilder.GetOptimalVideoStream`): the server direct plays only if all of the following hold:
  - `EnableDirectPlay`
  - the bitrate is not over the limit
  - the item is not a DVD/BluRay folder
  - the container is not a manifest (HLS etc.)
  - the container, video, audio and subtitle checks all pass
- **Direct stream is effectively dead.** `MediaInfoHelper` forces `options.EnableDirectStream = false` unless `ForceDirectStream` is set, with the comment "direct-stream http streaming is currently broken". `SupportsDirectStream` is then rewritten to equal `PlayMethod == DirectPlay`.
- **URL for mpv.** Use `GET {server}/Videos/{itemId}/stream?static=true&MediaSourceId={msid}` (spec: GET and HEAD; jellyfin-mpv-shim `media.py` ~l.759-790). `static=true` means a byte-exact passthrough with range requests, so mpv seeks natively.
  - Live TV: add `LiveStreamId`.
  - Pass auth with mpv's `http-header-fields=Authorization: MediaBrowser … Token="…"`, not in the URL.
  - Two caveats come from mpv-shim's `player.py` (~l.2925). `http-header-fields` is global and sticky, so clear it per item. Do not set it if any subtitle URL points at a foreign host, because the token would leak there.
  - Fallback is the `ApiKey=` query parameter (not `api_key`, which needs `EnableLegacyAuthorization`, off by default since v12).
- **Direct paths (optional).** If `MediaSource.Path` is reachable from the client (SMB/NFS mount), mpv can open it directly. mpv-shim gates this behind `direct_paths` + `remote_direct_paths` settings with SMB path rewriting. It is nice to have, not MVP.
- **Reporting** (spec 12.4.0): `POST /Sessions/Playing` (`PlaybackStartInfo`: ItemId, MediaSourceId, PlaySessionId, AudioStreamIndex, SubtitleStreamIndex, PositionTicks, PlayMethod=`DirectPlay`, CanSeek, IsPaused, …), `POST /Sessions/Playing/Progress` (same plus events; send every ~10 s and on pause, seek or track change), `POST /Sessions/Playing/Stopped` (PositionTicks; the server computes resume and played state from this). Ticks are 10 000 000 per second. Use `PlaySessionId` from the PlaybackInfo response.
  - The server marks an item played when stop position exceeds its max-resume percentage (default 90%). The 90% default comes from server config defaults: `unverified` here.
  - Explicit watched toggles are `POST` and `DELETE /UserPlayedItems/{itemId}`.
  - Resume reads `UserData.PlaybackPositionTicks` on the item DTO.
- **Subtitles.**
  - Embedded: mpv reads them from the container, with no server work.
  - External: `MediaStream.DeliveryMethod === 'External'` with `DeliveryUrl`. Load into mpv with `sub-add`. With a header-auth URL this works because the header is global.
  - `IsExternalUrl` is set exactly when `Path` is an absolute http(s) URI.
  - External streams are indexed **first** (Index 0..n). Never test an index for truthiness.
- **External audio tracks.** Selecting a sidecar audio track **always transcodes** (`TranscodeReason.AudioIsExternal`); no endpoint serves it raw (mpv-shim notes §11). Mitigation: let mpv add it via `audio-add` from the direct path when one is available. Otherwise flag the item as "external audio requires transcode". Also, the server remembers the per-user audio pick (`RememberAudioSelections`). One test that ends on a sidecar track turns every later start of that item into a transcode for that account. Reset this in tests.
- **Remote control (later).** `POST /Sessions/Capabilities/Full` plus the WebSocket, so other clients can cast to us. Out of MVP scope.

## 4. Test harness

### 4.1 Tier A: pure unit tests (no network)

- Store recorded `PlaybackInfoResponse` JSON fixtures, captured from tier B, under `fixtures/playbackinfo/*.json`.
- Unit-test the client-side decision function `choosePlayback(response) → { kind: 'direct', url } | { kind: 'refuse', reasons }`. It should parse `TranscodeReasons` out of `TranscodingUrl` (comma-joined flag names), build the static URL, and decide the auth mode.
- Also unit-test profile invariants with snapshot plus property checks:
  - `CodecProfiles.length === 0`
  - no condition with `Property === 'VideoRangeType'` anywhere
  - `MaxStreamingBitrate >= 1e9`
  - every DirectPlay entry has an empty Container and empty codecs
  - every TranscodingProfile codec CSV is ≤ 40 chars (server validator, per Jellium)
- zod-validate each fixture against the generated schemas, so a spec bump that breaks shapes fails loudly.

### 4.2 Tier B: real server in a container

- **Image.** `docker.io/jellyfin/jellyfin:12.4` (tags `latest`/`12`/`12.4` updated 2026-10-26; also `12.3`, plus dated `unstable`). Backed by `curl -s 'https://hub.docker.com/v2/repositories/jellyfin/jellyfin/tags?page_size=12'`. Run the matrix on `12.4` plus the latest 10.11.x image, since the SDK table shows users still on 10.11. Pin by digest.
- **Runtime.** podman 5.8.9 and docker 29.8.2 are both present (`which podman docker`). testcontainers for Node is at 12.2.1 (2026-10-13, npm). It works with rootless podman via `DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock` plus `TESTCONTAINERS_RYUK_DISABLED=true` (`unverified` on this machine). Plain `podman run` from a global setup script is the simpler alternative.
- **Headless first-run. Prior art exists.** `fredrikburmester/streamystats` `docker/dev/jellyfin/bootstrap.sh` is a clean, idempotent version. Others: `LLukas22/Jellyswarrm dev/scripts/init-jellyfin.py`, `streamyfin/streamyfin e2e/syncplay/setup.py`, `edde746/plezy scripts/maestro/maestro_real_jellyfin.py`, `kiriwalawren/nixflix modules/jellyfin/setupWizardService.nix` (`gh search code 'Startup/Complete'`). The sequence is:
  1. poll `GET /health`, then `GET /System/Info/Public` → `StartupWizardCompleted`
  2. `POST /Startup/Configuration {UICulture, MetadataCountryCode, PreferredMetadataLanguage}`
  3. `GET /Startup/User` (initialises the first user)
  4. `POST /Startup/User {Name, Password}`
  5. `POST /Startup/RemoteAccess {EnableRemoteAccess:true}`
  6. `POST /Startup/Complete`
  7. `POST /Users/AuthenticateByName {Username, Pw}` → `AccessToken`, using header `Authorization: MediaBrowser Client="harakiri-test", Device="ci", DeviceId="…", Version="0"`
  8. `POST /Library/VirtualFolders?name=Movies&collectionType=movies&refreshLibrary=false` with `LibraryOptions` that disable metadata fetchers, chapter and trickplay extraction (offline, fast)
  9. `POST /Library/Refresh`, then poll `GET /ScheduledTasks` until `RefreshLibrary` is `Idle`

  Caveat: the Startup Configuration, RemoteAccess and User endpoints are marked `[Obsolete("Use configuration endpoints")]` in 12.x (`Jellyfin.Api/Controllers/StartupController.cs`). They still work, but can be expected to move.

- **Fixture library**: a tiny clip, 2–5 s, per row:

  | Fixture                                                        | Expected range type / point           |
  | -------------------------------------------------------------- | ------------------------------------- |
  | HEVC 10-bit HDR10 MKV                                          | HDR10                                 |
  | HEVC HDR10+ (x265 `--dhdr10-info`)                             | HDR10Plus                             |
  | HEVC HLG                                                       | HLG                                   |
  | DV P5 MP4                                                      | DOVI                                  |
  | DV P8.1 MKV                                                    | DOVIWithHDR10                         |
  | DV P8.4                                                        | DOVIWithHLG                           |
  | DV P7 FEL dual-layer                                           | DOVIWithEL (if obtainable)            |
  | AV1 HDR10                                                      | —                                     |
  | TrueHD Atmos 7.1, DTS-HD MA, EAC3 JOC, FLAC 7.1, Opus          | —                                     |
  | PGS, ASS, SRT embedded; SRT/ASS/PGS sidecars; VobSub .idx/.sub | —                                     |
  | No-bitrate-in-container file                                   | exercises the 40 Mbps unknown default |
  | High-bitrate file (> 8 Mbps)                                   | catches the profile default           |
  - DV fixtures need real RPUs. Make them by encoding with x265 `--dolby-vision-profile 5|8.1 --dolby-vision-rpu`, or inject with `dovi_tool inject-rpu`, then mux with mkvmerge/ffmpeg so the container carries the DOVI config record that ffprobe reads. This is `unverified` and needs a spike. Generate once and commit, since they are small. Alternatively, use public DV test samples if the licence allows.

- **Assertions per fixture.** `POST /Items/{id}/PlaybackInfo` with our profile, then for every MediaSource:
  - `SupportsDirectPlay === true`
  - `TranscodingUrl` absent
  - the requested `MediaStreams[video].VideoRangeType` equals the expected range type (this proves the fixture really is DV P5 etc.)
  - a `HEAD /Videos/{id}/stream?static=true&MediaSourceId=…` returns 200 with `Accept-Ranges: bytes`

  Add **negative controls**: run the same request with the jellyfin-desktop default profile (`NotEquals DOVI`). It must yield `TranscodeReasons` containing `VideoRangeTypeNotSupported` for the P5 fixture. This proves the harness can see a transcode. Add bitrate controls too: profile without `MaxStreamingBitrate` on the high-bitrate fixture → `ContainerBitrateExceedsLimit`.

- **Speed.** First boot plus scan should take tens of seconds (`unverified`). Run once per suite with a shared server; mark the tier as opt-in locally and always-on in CI. Remember the project hook blocks shell commands containing the test runner's literal name. Wire the tier through a package script (e.g. `npm run test:integration`).

### 4.3 Tier C: msw

- msw latest is 3.0.3 (2026-10-10, npm). Use it for UI and data-layer tests: TanStack Query hooks, the reporting cadence (Start → Progress xN → Stopped with the right `PlaySessionId`/ticks), auth-header injection, 401 re-auth, and server-unreachable states.
- Serve tier-B recorded fixtures as handler payloads. Do not handwrite them, or they drift from the real server.
- Do not use msw to "test" direct-play logic. That logic lives on the server; only tier B can prove it.

## 5. Other things that force a transcode despite a permissive profile

| Cause                                                                                                 | Where                                                                                                        | Mitigation                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile omits `MaxStreamingBitrate`/`MaxStaticBitrate` → server default 8 Mbps                        | `DeviceProfile.cs` defaults; `MediaOptions.GetMaxBitrate`                                                    | Send 1e9 in the profile **and** in `PlaybackInfoDto.MaxStreamingBitrate`                                                                           |
| Unknown item bitrate is treated as 40 Mbps                                                            | `StreamBuilder.IsBitrateLimitExceeded`                                                                       | Covered by the above                                                                                                                               |
| Client off-LAN → `RemoteClientBitrateLimit` (per-user, else server config) caps MaxBitrate            | `MediaInfoHelper.GetMaxBitrate` (l.~520-539, `IsInLocalNetwork`)                                             | Show the user; the admin must raise or zero it, or add our subnet to LAN networks. Remote item sources (`IsRemote`) are exempt from bitrate checks |
| User policy `ForceRemoteSourceTranscoding` + remote source (.strm/http)                               | `MediaInfoHelper` l.~307                                                                                     | Surface it; nothing the client can do                                                                                                              |
| `EnablePlaybackRemuxing` / `EnableVideoPlaybackTranscoding` policy                                    | `MediaSourceManager` l.~224 sets `SupportsTranscoding`/`SupportsDirectStream`; **does not block DirectPlay** | Irrelevant to direct play; it only matters for fallback                                                                                            |
| DVD/BluRay folder (`VideoType.Dvd/BluRay`)                                                            | `StreamBuilder` l.~717                                                                                       | Not direct playable. mpv could play `bluray://` from a direct path; otherwise transcode                                                            |
| Manifest container (HLS)                                                                              | `StreamBuilder` l.~726                                                                                       | Expected                                                                                                                                           |
| Selected subtitle with no matching SubtitleProfile → `Encode` (burn-in) → `SubtitleCodecNotSupported` | `StreamBuilder` l.~1318-1331, `GetSubtitleProfile`                                                           | Enumerate formats (no wildcard: `Format` is matched with `string.Equals`); send `SubtitleStreamIndex=-1` and let mpv choose                        |
| Default subtitle chosen by user prefs (e.g. forced/always PGS)                                        | `GetDefaultSubtitleStreamIndex`                                                                              | Same as above                                                                                                                                      |
| External audio selected                                                                               | `AudioIsExternal`                                                                                            | See §3                                                                                                                                             |
| Remembered audio selection pointing at a sidecar                                                      | `RememberAudioSelections`                                                                                    | Reset in tests; avoid sidecar picks via server                                                                                                     |
| `AudioStreamIndex` without `MediaSourceId` silently ignored                                           | mpv-shim notes §11                                                                                           | Always pair them                                                                                                                                   |
| `force_transcode_*`-style CodecProfiles                                                               | jellyfin-desktop/mpv-shim                                                                                    | Never add them; if we add a "compat mode", keep it off by default and show it in the UI                                                            |
| `MaxAudioChannels` in the request                                                                     | Only affects TranscodingProfile / transcode path (mpv-shim notes)                                            | Omit                                                                                                                                               |
| BluRay ISO, or a codec ffprobe cannot identify (`UnknownVideoStreamInfo`)                             | `TranscodeReason` enum                                                                                       | Rare; log it                                                                                                                                       |

## 6. Decision table

| Problem                | Choice                                                                                                                                                                          | Why                                                                                                   | Considered & dropped                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jellyfin HTTP client   | Own client from vendored stable spec via `@hey-api/openapi-ts` (pinned 0.99.x) + `@hey-api/client-ky` + zod + TanStack Query plugins                                            | Matches house stack; no axios; real nullability; zod at the edge for free                             | `@jellyfin/sdk` 1.0.2: official and well-maintained, but axios peer, `allOf` flattening drops nullability, no `exports`/`sideEffects`. Hand-written fetch wrappers: too many DTOs |
| Spec source            | Vendored `jellyfin-openapi-stable.json` (12.4.0) with a manual bump script; optionally diff against the live server's `/api-docs/openapi.json` in tier B                        | Reproducible builds; tier B catches drift                                                             | Fetching at build time (non-reproducible)                                                                                                                                         |
| Range-type declaration | **No CodecProfiles at all**                                                                                                                                                     | Unconditionally passes every current and future range type; immune to server-version enum differences | Enumerating `EqualsAny SDR\|HDR10\|…\|DOVI…`: fragile, and it is exactly how web/desktop break                                                                                    |
| Containers/codecs      | Wildcard DirectPlay `{Type:'Video'}`, `{Type:'Audio'}`                                                                                                                          | Empty means accept-all; mpv plays anything FFmpeg demuxes                                             | Jellium-style enumeration from mpv capabilities: honest but name-mismatch risk; keep as a possible "diagnostics" view                                                             |
| Subtitles              | Enumerated Embed+External text, Embed image, External pgssub, mks dvdsub (12+)                                                                                                  | `Format` has no wildcard                                                                              | Single wildcard entry: does not exist                                                                                                                                             |
| Bitrate                | 1e9 in profile and request                                                                                                                                                      | Defeats the 8 Mbps default                                                                            | `int.MaxValue` (works, but 1e9 matches peers and is clearly intentional)                                                                                                          |
| Transcode fallback     | Keep minimal TranscodingProfiles, plus a strict mode (default on) that refuses non-DirectPlay with decoded reasons                                                              | User sees _why_; no silent quality loss                                                               | No TranscodingProfiles: server may return a useless response; silent fallback hides the bug class that triggered this project                                                     |
| Stream URL             | `/Videos/{id}/stream?static=true&MediaSourceId=…`, auth via mpv `http-header-fields` (cleared per item; fallback `ApiKey=`)                                                     | Byte-exact, seekable, no token in URL/logs                                                            | `api_key=` (off by default in v12); direct paths (later, opt-in)                                                                                                                  |
| Integration tests      | testcontainers or podman script + `jellyfin/jellyfin:12.4` and latest 10.11 + Startup API bootstrap + generated DV/HDR fixtures; assert `SupportsDirectPlay && !TranscodingUrl` | Only the server can decide direct play                                                                | Asserting on `TranscodeReasons` field (absent from MediaSourceInfo DTO); shared external test server like upstream SDK                                                            |
| UI/data tests          | msw 3 with tier-B recorded payloads                                                                                                                                             | Realistic, fast                                                                                       | Hand-written mocks                                                                                                                                                                |

## 7. Open risks

1. **DV fixture generation is unproven.** We have not shown that Jellyfin's ffprobe-based classifier yields `DOVI` for a synthetic P5 clip. This needs a spike with x265/dovi_tool.
2. **External audio sidecars always transcode.** No raw endpoint exists. A product workaround is needed: direct path, or accept the limitation.
3. **Startup API endpoints are `[Obsolete]`** in 12.x. The bootstrap script may need to move to `/System/Configuration` and the user endpoints in a later major.
4. **hey-api is pre-1.0** (0.99.0): its config may churn. Generation from a 1.9 MB spec with 357 schemas is unmeasured for speed and output size.
5. **Remote/WAN playback** depends on admin settings we cannot override (`RemoteClientBitrateLimit`, LAN subnet config). The UI must explain it.
6. **Server-version spread** (10.10 / 10.11 / 12.x). The wildcard profile is version-agnostic. The `{dvdsub, External, Container:'mks'}` entry must be gated to 12+, because 10.11 ignores `Container` and hands out 404/400 URLs (mpv-shim notes).
7. **TS 7 consumption of generated code** is `unverified`. hey-api output is plain TS, so the risk is low.
8. **Classification of rarer streams** (P7 FEL as `DOVIWithEL` vs `DOVIInvalid`) is irrelevant with no conditions, but it matters for UI badges. Read the server's `MediaStream.GetVideoColorRange` before relying on it (not read here).
