# harakiri

A TV-first, gamepad-first Jellyfin player. mpv plays every file as it is, HDR reaches the TV, and compressed audio reaches the receiver untouched. A harness proves both without an HDR TV or an AV receiver.

**Read `docs/PRD.md` before deciding scope, product behaviour, a fidelity rule, an acceptance criterion, or a harness requirement.** It is the source of truth; when this file, a brief, or an agent report disagrees with it, the PRD wins.

## Where things are written down

- `docs/PRD.md`: scope, behaviour, fidelity rules, acceptance criteria, harness tiers, out-of-scope list.
- `docs/research/`: the research behind every choice, including the library census (`07-media-census.md`). Check it before re-researching.
- `apps/desktop/PRODUCT.md` and `apps/desktop/.impeccable/surfaces/src-renderer.md`: product truth and the visual direction contract, in the formats the impeccable skill reads. `apps/desktop/DESIGN.md` is written at the impeccable finish review.

## Onboarding

```sh
mise trust && mise run setup
```

`setup` installs deps from the lockfile, registers hk hooks globally and verifies them, builds harakiri's mpv once (`mise run mpv:build`, cached in `.cache/mpv/<recipe-hash>`), and then runs `mise run doctor` to check the harness tools. Fedora system packages are outside mise: `weston` (>= 15), `kwin`, `mesa-vulkan-drivers`, `podman`, and the RPM Fusion `ffmpeg`, for the harness (Fedora's `ffmpeg-free` has no HEVC decoder).

`mise tasks` lists every command. `mise run check` is what CI gates on. `dev/jellyfin/COMMANDS.txt` starts the local dev Jellyfin on the generated corpus (`mise run media:gen`), or on your own library with `JELLYFIN_DEV_LIBRARY=own` in `.env`.

## Bound every heavy process

Heavy test, build and media processes can exhaust a dev machine's memory. Run every memory-hungry process through the bounded runner, which puts it in its own systemd scope under `harakiri.slice` (hard cap 7 GB for the slice by default, `HARAKIRI_SLICE_MAX`):

```sh
scripts/bounded.sh <name> <cap> -- <command>
scripts/bounded.sh e2e 4G -- bun x playwright test --workers=1
```

- Use it for test suites, builds, the mpv build (`mise run mpv:build`, podman with `--memory`), Electron, Playwright, `kwin_wayland`, Weston, and mpv or ffmpeg batches. The `mise` tasks and hk steps already do.
- Cap test workers: `--maxWorkers=2` for vitest, `--workers=1` for Playwright.
- Containers get `--memory`. The dev Jellyfin runs at 2 GB.
- `mise run watchdog` (`scripts/watchdog.sh`) watches system headroom and memory pressure. When either crosses its limit, it stops the largest scope in `harakiri.slice` and prints `WATCHDOG KILLED`. It never touches processes outside the slice.

## Architecture

- `apps/desktop`: Electron main, preload, and the React renderer (electron-vite).
- `packages/mpv`: typed JSON IPC client for mpv (`spawnMpv`) and the playback argument builder (`buildPlaybackArgs`).
- `packages/jellyfin`: client generated from the pinned OpenAPI spec, the "never transcode" `deviceProfile`, branded ids, stream URLs and auth headers.
- `packages/input`: the action model shared by keyboard, gamepad, and remote, and the routing guard between the UI and mpv.
- `packages/fidelity`: the pure engine that decides how each play reaches the output and how it steps down (bitstream to PCM, Vulkan to OpenGL, HDR to SDR), with a reason for every downgrade. No mpv, Electron, or Jellyfin types. `apps/desktop/src/main/player/fidelity-*.ts` adapts it to Jellyfin and mpv.
- `packages/harness`: the validation harness (IEC 61937 extractor, picture checks, the `doctor` CLI) and the generated media corpus (`src/corpus`, one catalog of every file and the Jellyfin classification it gets).
- `dev/jellyfin`: the local dev Jellyfin (podman, pinned image, idempotent bootstrap).

<important if="you are touching playback, video output, or the player UI">
mpv runs as its own fullscreen native window with `vo=gpu-next` and Vulkan. Never render mpv through libmpv's render API into the web view: it takes the swapchain away from mpv and kills HDR (jellyfin-desktop#523). On Wayland an app cannot stack its window over mpv's, so the player controls are drawn by the main process through mpv's `osd-overlay` (ASS), and mpv input bindings send `script-message harakiri <action>` back over IPC. Playback spawns mpv with an app-owned `--config-dir`.
</important>

<important if="you are changing how a play reaches the output: passthrough, renderer, HDR, transcode handling, or downgrade reporting">
Decisions live in `packages/fidelity`, never in the player. Add a scenario to `packages/fidelity/src/scenarios.ts` for any new case, run `mise run fidelity:table`, and review the diff of `docs/fidelity/compatibility.md`: it is the behaviour change. The desktop watcher only reports what mpv shows and applies the engine's actions. A missing output alone is not a failure; mpv's own `ao/` warning or `vo/` error is.
</important>

<important if="you are touching gamepad or input handling">
During playback mpv owns the gamepad (`--input-gamepad`). The renderer ignores gamepad input while the input mode is `player`, or one press acts twice. That guard lives in `packages/input` and is unconditional.
</important>

<important if="you are touching the Jellyfin DeviceProfile or PlaybackInfo requests">
The profile declares no CodecProfiles and wildcard DirectPlayProfiles, sends `MaxStreamingBitrate` 1e9 in the profile and the request, and lists every subtitle format. Any condition on `VideoRangeType` brings back the bug that started this project (see "Why harakiri exists" in the PRD).
</important>

<important if="you are passing headers, URLs with tokens, or any secret to mpv">
Secrets never go in mpv's argv: `/proc/<pid>/cmdline` is world-readable. Set headers over IPC with `setHttpHeaders` (packages/mpv) before `loadfile`, and add sidecar subtitles (their URLs carry `ApiKey`) with `sub-add` after the file loads. `playback.local.test.ts` reads mpv's real cmdline and fails if a token appears.
</important>

<important if="you are writing or changing web UI in apps/desktop/src/renderer">
All web UI goes through the impeccable loop: load the `impeccable` skill, run its `context --target apps/desktop`, read its craft floor before every UI edit, run its detector on what changed, then critique and audit. React code follows the `vercel-react-best-practices` rules. The finish review writes `apps/desktop/DESIGN.md`.
</important>

## Releases

- release-please keeps a release PR open on `main`. Merging it tags `vX.Y.Z`, and `.github/workflows/release.yml` uploads `harakiri-x86_64.AppImage` and `latest-linux.yml` to that release. Never edit the version in `apps/desktop/package.json` or `CHANGELOG.md` by hand.
- `mise run package` builds the same AppImage locally, and `mise run package:check` verifies it. `gh workflow run release.yml -f tag=vX.Y.Z` rebuilds and re-uploads an existing release.

## How work is verified

- Tests run the real thing where it is cheap (real mpv, real ffmpeg, generated media) and assert literal expected values.
- End-to-end tests (`mise run e2e`) drive the built Electron app with Playwright under a nested `kwin_wayland --virtual`, so they never open windows on the owner's desktop. They run against a real Jellyfin 12.4 container on the corpus (`harakiri-jellyfin-e2e`, 127.0.0.1:8296, discovery on 127.0.0.3), which the suite starts, scans, and leaves running for the next run; `mise run e2e:down` stops it. Podman is the only thing a fresh clone needs.
- After each build wave, adversarial reviews (the `interrogate` skill) check UI design, architecture, and other agents' code with at least two reviewers on different models.
- Report something as done only after observing it work: the test output, the built app, or the harness result.

<important if="you are adding or changing a test, a fixture, a harness check, or anything under dev/">
Everything committed must run and validate from a fresh clone on any machine: no NAS, no seeded server, no service the suite does not start itself, no personal paths, titles, domains or hardware. Media comes from the corpus catalog (`packages/harness/src/corpus/catalog.ts`): add an entry there for a new format. A test that needs a real Jellyfin or FATE samples goes in a tier file (`*.live.test.ts`, `*.contract.test.ts`, `*.fate.test.ts`) and throws naming the mise task that provides its dependency.

Validating against the owner's real library stays supported, as an opt-in run (`JELLYFIN_DEV_LIBRARY=own`, `JELLYFIN_DEV_URL`, `HARAKIRI_E2E_SERVER`, set in `.env`). Reproduce a bug found there, then commit a test that recreates it on the corpus, never a test that needs the owner's file.
</important>

## Rules and what enforces them

When the owner corrects a mistake, fix it and add the rule here with what enforces it. A rule that has no enforcement and is broken again gets enforcement in the same change.

| Rule                                                                                                                                                       | Enforced by                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tests never skip; a test that needs a server or samples lives in a tier and fails loudly without it                                                        | `scripts/lint-skips.ts` (hk pre-commit, `mise run check`); tiers selected by file name in `vitest.shared.ts`                                                |
| `mise run check` never needs a server, the NAS or the network once `mise run setup` has built the cached mpv (`.cache/mpv/<recipe-hash>`), like the corpus | Tier files are excluded from every package's default `vitest.config.ts`; `bundledMpv()` throws naming `mise run mpv:build` and never fetches                |
| No workstation paths, owner domains or library titles in tracked files                                                                                     | `scripts/lint-private.ts` (hk pre-commit, `mise run check`), with titles in the gitignored `.private-denylist`                                              |
| Recorded Jellyfin fixtures carry no real library data                                                                                                      | The recorders scrub through `@harakiri/jellyfin/fixture-scrub`; `scrub.test.ts` fails on an unscrubbed fixture                                              |
| The corpus gets the classification its catalog declares                                                                                                    | `mise run test:corpus` against a real scan                                                                                                                  |
| Fidelity decisions live in `packages/fidelity`                                                                                                             | `docs/fidelity/compatibility.md` is regenerated and diffed by `table.test.ts`                                                                               |
| No feature code names a platform; features ask host capabilities                                                                                           | `scripts/lint-host.ts` (hk pre-commit, `mise run check`)                                                                                                    |
| Secrets never reach mpv's argv                                                                                                                             | `playback.local.test.ts` reads mpv's real cmdline                                                                                                           |
| A hook that misfires is fixed in its config, never bypassed with `HK=0`; every tracked source file is linted and formatted                                 | `oxlint.config.ts` and `oxfmt.config.ts` drop the preset's `**/build` (apps/desktop/build holds source); `hk.pkl` passes `--no-error-on-unmatched-pattern`  |
| PR titles are Conventional Commits: GitHub only squash-merges, and the PR title becomes the commit on `main`                                               | `mise run lint:pr-title` (CI: `.github/workflows/pr-title.yml` on every PR open, edit and push); squash-only with PR-title commits is a GitHub repo setting |

## Conventions

- Packages ship raw `.ts`; there is no build step outside `apps/desktop`.
- zod at IO edges only (mpv IPC, Jellyfin, ffprobe JSON, env). ts-pattern for exhaustive matching.
- `packages/jellyfin/src/generated/` is generated by `mise run jellyfin:gen`. Regenerate it; never edit it.
- Conventional Commits for commits and PR titles, checked by hk on `commit-msg` and by `mise run lint:pr-title`. Lint and format gate the commit; typecheck and tests gate the push. `HK=0` bypasses.
- A local hook blocks any shell command that names the vitest runner without a worker cap. Always pass `--maxWorkers=2`.

## Dependencies

Chosen on 2026-10-30 after a researched ledger. Versions are pinned in `mise.toml`, the root `catalog:` and `bun.lock`.

### Chosen

| Problem               | Choice                                                                                                                                                   | Job                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| toolchain             | mise: bun 1.4.4, node 26.13.0, hk 2.10.0, dovi_tool 2.3.4, hdr10plus_tool 1.7.2                                                                          | exact pins, one onboarding command                                   |
| shell                 | electron 45.1.0                                                                                                                                          | TS main process, mature Chromium input                               |
| dev build / packaging | electron-vite 6.0.0, electron-builder 26.18.0                                                                                                            | dev server; AppImage                                                 |
| video                 | harakiri's mpv build (`mpv/`): mpv 0.42.0 + libplacebo 7.387.0 + FFmpeg 9.0.2 + SDL2 2.32.10; RPM Fusion ffmpeg 8.1.3 for the harness                    | playback, HDR, passthrough                                           |
| mpv control           | hand-rolled JSON IPC client (`packages/mpv`)                                                                                                             | every npm client is stale                                            |
| player controls       | hand-rolled `osd-overlay` ASS from the main process                                                                                                      | Wayland cannot stack a web window over mpv                           |
| Jellyfin client       | @hey-api/openapi-ts 0.99.0 + ky 2.2.0, from a pinned 12.4.0 spec                                                                                         | generated typed client, zod and Query plugins                        |
| hey-api compiler      | typescript as `npm:@typescript/typescript6@6.0.2` in `packages/jellyfin` only                                                                            | TS 7 has no compiler API                                             |
| UI                    | react 19.3.1, vite 8.3.5, tailwindcss 4.3.3, @tanstack/react-router 1.170.46, @tanstack/react-query 5.105.0, zustand 5.0.16                              | renderer stack                                                       |
| focus navigation      | @noriginmedia/norigin-spatial-navigation 3.4.0, @tanstack/react-virtual 3.14.24                                                                          | d-pad navigation over virtualized rows                               |
| gamepad               | Gamepad API in the renderer; mpv `--input-gamepad` during playback                                                                                       | no native addon                                                      |
| validation / types    | zod 4.6.7, ts-pattern 5.9.2, es-toolkit 1.53.0, type-fest 5.10.0                                                                                         | IO edges, exhaustive matching                                        |
| config                | @t3-oss/env-core 0.13.11                                                                                                                                 | validated env                                                        |
| logging               | @logtape/logtape 2.4.2, @logtape/pretty 2.4.2                                                                                                            | one API in main, renderer and CLI                                    |
| auto-update           | electron-updater 6.8.11                                                                                                                                  | AppImage self-update from the public GitHub release                  |
| harness CLI           | @optique/core, @optique/run, @optique/zod 1.3.6, @clack/prompts 1.8.1                                                                                    | typed subcommands, terminal output                                   |
| IEC 61937 extraction  | hand-rolled (`packages/harness`)                                                                                                                         | FFmpeg's spdif demuxer cannot read TrueHD or DTS-HD                  |
| tests                 | vitest 5.0.5, @vitest/browser-playwright 5.0.5, @playwright/test 1.64.1, @testing-library/react 16.3.3, happy-dom 21.0.4, msw 3.0.3                      | unit, browser-mode focus tests, Electron e2e                         |
| lint / format / types | oxlint 1.90.0 + oxlint-tsgolint 7.0.2005, oxfmt 0.75.0, typescript 7.0.2; ultracite 8.2.1 presets (core, react, tanstack, vitest, playwright, anti-slop) | rule set in `oxlint.config.ts`, `oxfmt.config.ts`                    |
| hooks                 | hk 2.10.0 (`hk.pkl`)                                                                                                                                     | lint and format on commit, typecheck and tests on push               |
| headless HDR          | kwin_wayland `--virtual`, weston 15 headless, lavapipe                                                                                                   | HDR harness without a display                                        |
| releases              | googleapis/release-please-action v5 (release-please 17.6.0)                                                                                              | version, changelog, tag and GitHub release from Conventional Commits |

### Considered, rejected

- Wails v3.0.0: stable for 3 days at decision time, Go backend, WebKitGTK gamepad bug 328634, many open Linux issues, no Flatpak packaging.
- Tauri: only worth it for the phase-2 overlay, where its Rust backend could reuse Jellium's Wayland proxy.
- Forking Jellium (andrewrabert/jellium-desktop): GPL-2.0, about 70k lines of Rust plus CEF, built around jellyfin-web. Its pattern is the phase-2 reference.
- libmpv render API (electron-libmpv, mpv.js, go-mpv render): kills HDR.
- `--wid` embedding: not supported on Wayland. Transparent window over mpv: Wayland cannot stack it.
- node-mpv (2020), mpv-ipc (2018), porsager `mpv` (single maintainer): stale or too thin to adopt.
- uosc: Lua OSD, not our UI. An mpv JS script: mujs is ES5 only (TS 7 dropping the ES5 target is unverified).
- @jellyfin/sdk 1.0.2: axios peer, drops nullability, no `exports` map.
- Listing each DOVI range type in CodecProfiles: how jellyfin-web and Jellyfin Desktop break.
- @kmamal/sdl: one maintainer, last release 2025-08; plan B if mpv's gamepad input proves unreliable.
- react-tv-space-navigation (beta since 2025-07), @bbc/lrud (0.0.x), the W3C spatial navigation polyfill (archived).
- node-cec (2016); HDMI-CEC deferred to the kernel CEC framework.
- Bun fullstack dev server: TanStack Router's plugin does not support Bun's bundler.
- @electron-forge 8.0.1: more maintainers, kept as the packaging fallback.
- Fedora `ffmpeg-free`: no HEVC, H.264 or VC-1 decoders.
- System mpv for dev and tests: Fedora's build hid #13 (`sdl2-gamepad`), so dev, tests and e2e run harakiri's own build (Q12).
- FFmpeg's spdif demuxer for verification: no TrueHD or DTS-HD support. PipeWire null sink: accepts plain PCM only.
- VKMS virtual display for HDR: no EDID or HDR_OUTPUT_METADATA support. Faking HDR on KWin virtual: its output always reports SDR.
