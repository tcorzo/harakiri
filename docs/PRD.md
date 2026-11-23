# harakiri product requirements

harakiri is a TV-first, gamepad-first player for a Jellyfin library. mpv plays every file as it is, HDR reaches the TV, and compressed audio reaches the receiver untouched. This document is the source of truth for scope, behaviour, and acceptance. When code, a brief, or an agent's report disagrees with it, this document wins until the owner changes it.

Related documents:

- `CLAUDE.md`: how to work in the repo (commands, conventions, dependency ledger).
- `apps/desktop/PRODUCT.md`: product truth in the format the impeccable design skill reads.
- `apps/desktop/.impeccable/surfaces/src-renderer.md`: the visual direction contract.
- `docs/research/`: the research reports and the library census behind every choice here.

## Why harakiri exists

The owner's Jellyfin Desktop transcoded a Dolby Vision Profile 5 episode to H.264 with AAC 5.1. HDR was lost, and the DD+ track reached the AV receiver as PCM instead of a bitstream. The server log said `TranscodeReasons=VideoRangeTypeNotSupported`.

The cause is a client setting, not a player limit. Jellyfin Desktop ships "Force Transcode Dolby Vision" switched on (`resources/settings/settings_description.json`). It adds a `VideoRangeType NotEquals DOVI` condition to the device profile (`native/nativeshell.js`). Profile 5 has no fallback layer, so the server classifies it as bare `DOVI` and transcodes it. Profiles 7 and 8 classify as `DOVIWith*` and pass.

The Qt Jellyfin Desktop also cannot output HDR at all. It renders libmpv through the render API inside its web view, which takes the swapchain away from mpv (jellyfin-desktop#523). Jellium (andrewrabert/jellium-desktop, Rust and CEF) shows that HDR works when mpv keeps its own swapchain.

harakiri fixes both causes. It tells the server it can play anything, and it lets mpv own the picture.

## Who it is for

One owner, on the couch, with a gamepad. The TV is a 4K HDR set across the room. Sound goes through an AV receiver capable of 7.1 and Atmos. Other household members are rare. Profile switching exists but stays out of the way.

The owner wants a sort of Tidal for films: a premium, theatrical library in which fidelity is visible and trusted. The two failure modes the owner named are a busy or gamer-like interface and fidelity information that reads like a codec spec sheet.

## Product principles

1. Play the file as it is. Never transcode silently. When the server transcodes, say so with the reasons.
2. Fidelity is visible. Picture and sound facts appear where they help a decision, stated precisely, never as hype.
3. Three presses to playing. From launch to playing something wanted takes as few inputs as possible.
4. The couch is the desk. Every interaction works with a d-pad, select, and back, at ten feet.
5. The library is the hero. The owner's artwork carries the experience. The interface recedes around it.

## What the library contains

The census of 1,602 files (1,592 probed, `docs/research/07-media-census.md`) sets the formats harakiri must handle.

| Picture class                         |                      Files |
| ------------------------------------- | -------------------------: |
| SDR                                   |                      1,446 |
| Dolby Vision 8.1 (12 with HDR10+)     |                         63 |
| HDR10                                 |                         48 |
| Dolby Vision 7 with enhancement layer | 19 MKV, 2 dual-stream m2ts |
| Dolby Vision 5                        |                         10 |
| HDR10+ only                           |                          3 |
| HLG                                   |                          0 |

- Video codecs are HEVC (921), H.264 (598, including 36 Hi10P), AV1 (62), and VC-1 (11). All HDR is HEVC Main10.
- Audio that can be bitstreamed is TrueHD (including 22 Atmos), DTS-HD MA (including 2 DTS:X), E-AC3 (including 62 Atmos), DTS, and AC3. 914 files have no track that can be bitstreamed (AAC, Opus, FLAC, LPCM) and decode to PCM.
- Subtitles are PGS (614 files), SRT (526), ASS (329), and VobSub (29). 1,272 files have a sidecar `.srt`.
- Containers are MKV (1,484), MP4 (104), and MPEG-TS (4).

## MVP scope

The MVP is done when all three features below meet their acceptance criteria on Fedora 44 with KDE Plasma on Wayland.

### First-boot onboarding

On first launch the owner reaches a playable library without help.

1. Find the server. harakiri broadcasts Jellyfin discovery (UDP 7359) and lists the servers that answer. The owner can also type an address. harakiri validates it with `GET /System/Info/Public` and shows the server name and version.
2. Sign in. The owner signs in with a username and password, or with Quick Connect when the server supports it. harakiri lists the server's public users as a shortcut.
3. Land in the library. The session (server, user, token, device ID) persists across restarts. The token is encrypted with Electron `safeStorage`. Where no keyring is available, as in Steam Game Mode under autologin, the token is kept in a file only this user can read. Settings says so, and the token can be revoked from the server's dashboard.

Acceptance:

- A fresh profile reaches the library in under a minute with only a gamepad.
- An unreachable server, a wrong password, and a server that rejects the client each show a plain message and a way back.
- A restart after sign-in goes straight to the library.
- Sign-out and server change exist in settings.

### Library gallery

The library screen follows the direction contract: a festival programme for one.

- **Hero.** A full-bleed backdrop of a featured film with its logo or wide title, its programme notes, and Play focused. The hero advances through several films on a short hold, and a bar of one segment per film shows the hold and lets the d-pad choose a film. Focus re-lights the whole field.
- **Continue Watching** follows the hero, with progress shown.
- **Programme sections** follow: Next Up for series, Recently Added, and sections drawn from the library such as genres or collections.
- **Title page.** A film page has programme notes, synopsis, cast, Play, and Resume when partly watched. Audio and subtitle choice live here or in the player. A series page leads to seasons and then episodes.
- **Programme notes** state year, runtime, picture class, and sound class from the server's media streams, for example "1962 · 133 min · 4K Dolby Vision · TrueHD Atmos 7.1". They never read as a raw codec list.

Acceptance:

- From launch, the owner can reach and play any film or episode with the d-pad alone.
- Focus movement shows no visible lag. Rows virtualize, and images load at the size shown.
- Reduced motion stops the hero from advancing on its own and removes non-essential transitions.
- Every interactive element shows focus without relying on colour alone.

### Player

Playback runs in mpv's own fullscreen window, which is required for HDR.

- **The screening handoff** is the signature interaction. The house dims, and a programme slug states the signal path, for example "Dolby Vision mapped to HDR10 · TrueHD Atmos bitstream". Then mpv takes the screen.
- **Controls** are drawn by the Electron main process through mpv's `osd-overlay` (ASS) and styled to match the library. They cover play and pause, seek with a scrub bar, skip back and forward, audio track, subtitle track, the signal-path readout, and stop.
- **Input.** mpv owns the gamepad during playback through `--input-gamepad`. Its bindings send `script-message harakiri <action>` to the main process. The renderer ignores the gamepad while the input mode is `player`. That guard is unconditional.
- **State.** harakiri reports start, progress (at least every 10 seconds), pause, and stop to Jellyfin. Resume position and played state round-trip. After an episode ends, the next one is offered.
- **Server transcode.** If PlaybackInfo returns a `TranscodingUrl`, the handoff and the player state the reasons in plain words.

Acceptance:

- Every fixture class in the census list plays: DV 5, DV 7 (base layer plus RPU), DV 8.1, HDR10, HDR10+, SDR H.264, Hi10P, AV1, VC-1, and MPEG-TS.
- The harness tiers in "How harakiri proves fidelity" pass for picture and sound.
- Quitting the player returns to the title page with the resume position updated.

## Fidelity rules

- **Picture.** mpv runs with `vo=gpu-next`, Vulkan, and `target-colorspace-hint`. Dolby Vision is delivered to the display as HDR10: libplacebo applies the RPU, and mpv outputs PQ. A native Dolby Vision signal over HDMI is out of scope. HDR10+ dynamic metadata is applied by libplacebo. KDE does not advertise HLG, so HLG would reach the compositor as PQ (the library has none).
- **Dolby Vision 7 enhancement layer.** mpv 0.41 plays the base layer plus RPU. The full enhancement layer needs mpv master with libplacebo 7.387 or newer. harakiri now ships its own mpv build (mpv 0.42.0, libplacebo 7.387.0), but those 21 files stay marked degraded until the player applies and reports the enhancement layer.
- **Sound.** mpv bitstreams AC3, E-AC3 (including Atmos), TrueHD (including Atmos), DTS, DTS-HD MA, and DTS:X with `--audio-spdif=ac3,eac3,dts-hd,truehd`. Atmos and DTS:X live inside the bitstream, so a byte-identical bitstream carries them. Each play bitstreams only the codecs the default PipeWire sink lists as IEC 61937 formats.
- **Reliable playback over best quality.** Every play aims for its best signal and steps down when the output path cannot carry it, so something always plays. `packages/fidelity` decides each step, and the player applies it to mpv while playing. Each step is a downgrade with a reason and a sentence the UI can show.
  - Sound: bitstream, then decoded PCM, then no sound with the picture carrying on. An output that does not list a codec gets it decoded. A bitstream that stops playing, which mpv's PipeWire output signals only by warnings, steps down to decoding mid-play. A DTS-HD track is decoded rather than cut to its lossy DTS core.
  - Picture: `gpu-next` on Vulkan, then `gpu-next` on OpenGL, then `gpu` on OpenGL, then no picture with the sound carrying on. Only Vulkan sends HDR, so the OpenGL rungs and an SDR display tone-map HDR to SDR.
  - Delivery: a server transcode is a downgrade per leg, with the server's reasons.
  - After a step-down, playback returns to the last moment an output was playing: with both outputs down, mpv has no clock and races through the file.
  - `docs/fidelity/compatibility.md` is the compatibility and downgrade table, generated from the engine (`mise run fidelity:table`). A test fails when it and the engine disagree.
- **Run log.** Every run writes `harakiri-<start time>-<pid>.log` under Electron's logs dir (`~/.config/harakiri/logs` for the AppImage, `~/.config/@harakiri/desktop/logs` in dev), keeping the newest 10. It holds harakiri's debug log, mpv's verbose output with tokens redacted, renderer console warnings and errors, and crashed processes. A postmortem starts there, not in a terminal.
- **Jellyfin profile.** The device profile declares no CodecProfiles, wildcard DirectPlayProfiles, and `MaxStreamingBitrate` of 1e9 in the profile and in the request. It lists every subtitle format. PlaybackInfo requests send `SubtitleStreamIndex=-1`, so mpv picks tracks. A condition on `VideoRangeType` brings back the original bug.
- **Signal-path vocabulary.** Each note has a delivery state. _Native_ means the signal passes as it is (HDR10 out, or a bitstream). _Mapped_ means harakiri converts it on purpose (Dolby Vision applied and delivered as HDR10). _Decoded_ means the sound becomes PCM because the format cannot be bitstreamed.

## Architecture constraints

These constraints are settled. Changing one is a product decision for the owner.

- The shell is Electron 45. The main process is TypeScript.
- mpv runs as its own native fullscreen window. It never renders through libmpv's render API into the web view. On Wayland an app cannot stack its window over mpv's, so player controls are drawn by mpv's `osd-overlay`.
- The main process controls mpv over JSON IPC (`packages/mpv`). Playback spawns mpv with an app-owned `--config-dir`, so a personal `mpv.conf` cannot change the validated path.
- The renderer is React 19 with Vite, TanStack Router and Query, Tailwind 4, and norigin spatial navigation.
- The Jellyfin client is generated from a pinned OpenAPI spec (`packages/jellyfin/openapi/`).
- A React overlay over live video is phase 2. It would copy Jellium's Wayland-proxy subsurface pattern, not its code.

## How harakiri proves fidelity

No part of the harness needs an HDR TV or an AV receiver. Real-library fixtures are cut by script into `fixtures/real/`, which git ignores. Only synthetic fixtures are committed.

| Area     | Tier        | What it proves                                                                                                                                                                                 |
| -------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sound    | T0          | `ffmpeg -f spdif` output, extracted by `packages/harness`, is byte-identical to the source track. A core-only DTS downgrade fails.                                                             |
| Sound    | T1          | The same holds through `mpv --ao=pcm --audio-spdif=...`.                                                                                                                                       |
| Sound    | T3          | Optional, needs root: `snd-aloop` with an `iec958` ALSA device and PipeWire.                                                                                                                   |
| Sound    | T4          | On the target box: the HDMI ELD lists the receiver's codecs.                                                                                                                                   |
| Picture  | T2          | mpv properties under `kwin_wayland --virtual` with lavapipe: `video-params`, `video-target-params`, the Dolby Vision profile, and the reshaping pass in `vo-passes`.                           |
| Picture  | T3          | `WAYLAND_DEBUG=client` shows mpv setting PQ, BT.2020, and HDR metadata. Weston 15 headless stands in for an HDR TV.                                                                            |
| Picture  | T4          | mpv screenshots match `ffmpeg -vf libplacebo` references, including the Dolby Vision green and purple check.                                                                                   |
| Jellyfin | integration | A real `jellyfin/jellyfin:12.4` and 10.11 in podman return `SupportsDirectPlay` with no `TranscodingUrl` for every fixture. Jellyfin Desktop's profile, run as a negative control, transcodes. |

End-to-end tests drive the built Electron app with Playwright under a nested headless KWin, so they never touch the owner's desktop. By default they run against a real Jellyfin 12.4 container that serves the generated corpus. The suite starts it with podman, bootstraps it, waits for its scan, and leaves it running for the next run. Each checkout runs its own, so several checkouts can run the suite at once. Most specs run inside a KVM microVM guest (`dev/vm`), and the few that need the host's network run on the host, so a fresh clone needs podman, `kwin_wayland` and a read-write `/dev/kvm`; the first run downloads the pinned image, the guest and its packages. Tests restore the user data they change and revoke the devices they sign in. `HARAKIRI_E2E_SERVER` runs the same suite against another Jellyfin, such as the owner's own. They cover:

- onboarding from a fresh profile, including failure paths;
- d-pad and emulated gamepad navigation through the hero, the rows, and the title pages;
- the play handoff, with assertions on mpv's real state over IPC (file loaded, position advancing, pause, seek, track changes, stop);
- progress and resume round-tripping through the server;
- the input guard, so a gamepad press in player mode never reaches the renderer.

Everything committed runs and validates from a fresh clone on any machine: no NAS, no seeded server, no service the suite does not start itself. Test media is generated (`mise run media:gen`, plus FFmpeg's public FATE samples for the formats no encoder makes), and tests that need a real server are opt-in tiers that fail loudly when it is missing. Validating against the owner's real library stays supported as an opt-in path configured in the gitignored `.env`, and its results never become committed assertions.

## How the work is done

- All web UI goes through the impeccable loop: direction contract, craft floor before every UI edit, the detector, critique, audit, and the finish review that writes `DESIGN.md`.
- React code follows the vercel-react-best-practices rules and the related Vercel composition skills.
- Adversarial reviews (interrogate) run after each build wave on UI design, architecture, and the code other agents wrote. At least two reviewers run on different models.
- Nothing is reported done until it was observed working: tests, the built app, or the harness.
- Every memory-hungry process (test suites, builds, Electron, Playwright, compositors, containers, media batches) runs under a hard memory cap through `scripts/bounded.sh`, and a watchdog (`scripts/watchdog.sh`) stops the largest harakiri process when system headroom runs low.

## Distribution and updates

- harakiri ships as one Linux x64 AppImage, attached to each GitHub release of `tcorzo/harakiri`. It carries harakiri's own mpv build in `resources/mpv` (mpv, FFmpeg and the libraries they load, with every license file) and never needs a system mpv. A source checkout builds the same bundle (`mise run mpv:build`).
- The bundled mpv is conveyed under GPLv3, and harakiri stays MIT: mpv is a separate program that harakiri talks to over IPC. Each release also carries `harakiri-mpv-source.tar`, the bundle's complete corresponding source (the `mpv/` recipe at the tag, every pinned source tarball and the Fedora 44 source RPM of every library copied from Fedora), and its notes point to it.
- release-please cuts releases: Conventional Commit titles on `main` keep a release PR open, merging it tags `vX.Y.Z`, and `.github/workflows/release.yml` builds the mpv bundle (cached by recipe hash), `mise run package` and `mise run mpv:source`, checks the AppImage, and uploads the AppImage, `latest-linux.yml`, `harakiri-mpv-source.tar` and `SHA256SUMS`.
- A running AppImage checks the latest release at startup and every 6 hours (a failed check is retried after 15 minutes), downloads only while nothing plays (a download in progress stops within a minute of playback starting and resumes after it), and installs on the next quit after mpv has stopped. Settings shows the state and offers "Restart to update". The download is verified by the sha512 in `latest-linux.yml` only.
- Not shipped: Flatpak, Snap, rpm, deb or pacman packages; code or GPG signing; beta channels, rollback and staged rollouts.

## Out of scope for the MVP

- A native Dolby Vision signal over HDMI.
- The full Dolby Vision 7 enhancement layer (needs a custom mpv build).
- A React overlay over live video.
- Windows and macOS builds.
- Several servers at once, offline downloads, and music.
- HDMI-CEC remotes (later, through the kernel CEC framework).

## Open questions

- How far the mpv-drawn controls can carry the visual world in ASS.
- Whether mpv's SDL gamepad input stays reliable when focus moves. If it does not, the fallback is the Chromium Gamepad API in the background or a native reader in the main process.
- When harakiri ships its own mpv build (Flatpak with mpv master and libplacebo 7.387) to unlock the enhancement layer.
