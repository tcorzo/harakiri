---
task: 2026-11-20-bazzite-plug-and-play
type: plan
repo: harakiri
branch: tcorzo/bazzite-first-party
sha: 25991bc3f6ab1d9b9d8bb522914071a50ef71715
---

**Repos touched:** `harakiri`

# Bazzite plug and play, part 3: dev, tests and e2e run harakiri's own mpv build — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build mpv 0.42.0 with libplacebo 7.387.0, FFmpeg 9.0.2 and SDL2 2.32.10 from a pinned container recipe, cache it by recipe hash, and make every test, the harness, dev and e2e run that build, so no system mpv is needed anywhere (#13, #17).

**Architecture:** The recipe lives in `mpv/`. `mise run mpv:build` builds it under podman into `.cache/mpv/<recipe-hash>/`, where the hash covers every file in `mpv/`. `packages/mpv` owns the resolver `bundledMpv()`, so tests in every package use the same build. The desktop adds `mpvBinary()`, which is `HARAKIRI_MPV ?? bundledMpv()` in dev and keeps `mpv` from `PATH` in a packaged app until Phase 8 adds `resources/mpv/mpv`. The checks from Q4 that mpv 0.42 changes land as tests on the real build.

**Tech Stack:** podman 5 (`build --memory`, `-v`, `-o type=local`), meson and ninja, FFmpeg `configure`, CMake (SDL2), patchelf, bun scripts, TypeScript 7, vitest 5 (`--maxWorkers=2`), Playwright e2e under nested KWin.

**Spec:** `docs/tasks/2026-11-20-bazzite-plug-and-play/03-structure-outline-bazzite-plug-and-play.md` (Phase 7, with Phase 8 for what it needs from this phase, and the Open Question "Network for the default tier", resolved 2026-11-21), `02-design-discussion-bazzite-plug-and-play.md` (Q3, Q4, Q4a, Q8, Q12), `01-research-bazzite-game-mode.md` (§4, §7, §11, §13.4). The outline wins where they differ.

**Not in this plan:** shipping the build in the AppImage, `package:check`, the release job, the GPL source upload and the PRD's distribution text (Phase 8). The DV 7 FEL observation and the FATE FEL test (Phase 9).

**Depends on:** plan 04 (merged: `MpvStartError`, `hdrSignalling` in `PlaybackDeps`). Tasks 1 to 6 need nothing else. **Task 7 needs Phase 4 merged first.** Phase 4 is planned in parallel and provides the `**/*.platform.test.{ts,tsx}` tier, `mise run test:platform`, `dev/vm/guest.sh exec`, `dev/vm/provision.sh` (which installs Fedora's mpv) and `packages/mpv/src/gamepad.platform.test.ts`. Task 7 changes the last two.

## Decisions this plan makes beyond the outline

- **The recipe hash.** It is the first 16 hex digits of a sha256 over every regular file under `mpv/`, sorted by relative path. Each file contributes `<relative path>\0<sha256 of its bytes>\n`. So any change to `Containerfile`, `build.sh`, `fetch.sh`, `versions.env` or `host-libs.txt` gives a new hash. A file's mtime does not. Nothing else goes in `mpv/`.
- **The cache layout.** `.cache/mpv/<hash>/` holds `mpv`, `lib/` and `manifest.json`. `.cache/mpv/src/` holds the verified source tarballs, which Phase 8 uploads. A build is written to `.cache/mpv/<hash>.partial/` and renamed when it is complete. After a build, `mpv:build` removes the other `<hash>` dirs. There is no env override for the cache dir: the Phase 4 guest mounts only the worktree, so a cache outside it would not reach the guest. Each worktree builds its own bundle once.
- **How the resolver finds the build from any package.** `bundledMpv()` walks up from its own file (`import.meta.dirname`) to the first directory that holds `mpv/versions.env`. That directory is the checkout root. This works from `packages/*/src`, from `apps/desktop/out/main` (electron-vite bundles `@harakiri/mpv` into the main entry), and from `/workspace` in the guest. The result is memoized per process.
- **FFmpeg 9.0.2, not 9.1.** FFmpeg 9.1 came out on 2026-11-20, one day before this plan and after mpv 0.42.0 (2026-11-05). 9.0.2 (2026-09-18) has `dovi_split` (`libavcodec/bsf/dovi_split.c`), which Q4 needs. A move to 9.1 is a `versions.env` edit.
- **The base image is `fedora:44`, pinned by index digest, and the build installs from the frozen `fedora` release repo only** (`--disablerepo='*' --enablerepo=fedora`). Fedora's release repo never changes after GA, so the build dependencies do not drift between builds of one hash. This sets the bundle's glibc floor at Fedora 44's. That is above the glibc 2.39 of the `ubuntu-24.04` runner that `release.yml` pins "to keep the AppImage portable". The targets (Bazzite and Fedora KDE) are Fedora 44 or later. Phase 8's `package:check-bazzite` confirms it on the Bazzite image.
- **SDL2 is built from source, 2.32.10**, the last SDL2 release. It is not `sdl2-compat` over SDL3, which is how Fedora's own mpv gets SDL2.
- **FFmpeg links no TLS library.** All https goes through mpv 0.42's libcurl backend (`-Dlibcurl=enabled`). mpv 0.42 also routes FFmpeg's nested HTTP opens (HLS segments) through it. The bundle carries the base image's `libcurl-minimal` and its OpenSSL. Their CA bundle path, `curl-config --ca`, is recorded in `manifest.json`.
- **The host-libs allowlist is checked against `DT_NEEDED`, not against `ldd`'s closure.** `ldd` also lists what the host's own libraries need (`libpulse` pulls in `libsndfile`, `libdbus`, and more), and those are not the bundle's business. The allowlist widens the outline's six groups. It adds `libstdc++` and `libgcc_s`, which the host's GPU driver loads into the same process, and `libxkbcommon`, the GLVND libraries, `libdrm`, `libgbm`, `libva` and `libvdpau`, which are the driver side of Wayland, EGL and hwdec.
- **`spawnMpv`'s `binary` becomes required.** Nothing in the codebase resolves `mpv` on `PATH` by default any more.
- **Until Phase 8, a packaged app keeps `mpv` from `PATH`.** The outline's `HARAKIRI_MPV ?? bundledMpv()` would throw in the v0.1.x AppImage, which has no checkout to walk up to. Users and the HTPC's wrapper would lose playback between the two phases. `resolveMpvBinary` takes `packaged`, and Phase 8 replaces that branch's `"mpv"` with `resources/mpv/mpv`.
- **`PlaybackDeps.mpvBinary` is a string**, resolved per play by `create-player.ts`, like `hdrSignalling`. It is not the outline's `deps.mpvBinary()` function. `PlayerWiring.mpvBinary` is the function.
- **e2e drops `HARAKIRI_MPV` from the app's environment**, so a developer's override never reaches e2e.
- **doctor's `podman` check becomes required.** `mpv:build` and the e2e Jellyfin both need podman.
- **The research's T4 picture references do not exist in code** (research §13.2), so there is nothing to rebuild against 7.387. The T2 `vo-passes` expectation is in `player.hdr.spec.ts` and is re-checked in Task 5.

## Global Constraints

- Pinned versions. These are copied verbatim into `mpv/versions.env` (Task 1). Each sha256 was computed on 2026-11-21 from the download, and verified as noted:

  | Component        | Version     | Source tarball                                                                                                 | sha256                                                                                              | Verified by                                                                                                              |
  | ---------------- | ----------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
  | base image       | `fedora:44` | `registry.fedoraproject.org/fedora:44@sha256:4f9a6c2f1eef83984ab0a2365fa99b3c080b0b028a02884c42f74ef8cb39e2fc` | (the index digest; amd64 `sha256:b0b9db74b46c54b376a5d4ebe9ed2b17567b5e01075b8dc3652026b831f59de8`) | `skopeo inspect --raw`                                                                                                   |
  | mpv              | 0.42.0      | `https://github.com/mpv-player/mpv/archive/refs/tags/v0.42.0.tar.gz`                                           | `bcfebbfa2b65a6d88dc97ea18117831072373e38b5785a2afb874ed4df5070dd`                                  | `mpv-0.42.0.tar.gz.asc` from the GitHub release: good signature, key `DE53 7FA4 CD83 E657 227D 6461 D6CA 75F6 505F 42A5` |
  | libplacebo       | 7.387.0     | `https://code.videolan.org/videolan/libplacebo/-/archive/v7.387.0/libplacebo-v7.387.0.tar.gz`                  | `3bf5d72786682c194387c33d563872f6bfe202a9816f9dde6535a31a9b2e0d74`                                  | no upstream signature; tag `v7.387.0` is commit `275f7dea27924cdd34ab2e6c20e448b6bc4fab65` (GitLab API)                  |
  | FFmpeg           | 9.0.2       | `https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz`                                                              | `8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e`                                  | `ffmpeg-9.0.2.tar.xz.asc`: good signature, FFmpeg release key `FCF9 86EA 15E6 E293 A564 4F10 B432 2F04 D676 58D8`        |
  | SDL2             | 2.32.10     | `https://github.com/libsdl-org/SDL/releases/download/release-2.32.10/SDL2-2.32.10.tar.gz`                      | `5f5993c530f084535c65a6879e9b26ad441169b3e25d789d83287040a9ca5165`                                  | equals the GitHub release asset digest                                                                                   |
  | nv-codec-headers | 13.0.19.1   | `https://github.com/FFmpeg/nv-codec-headers/releases/download/n13.0.19.1/nv-codec-headers-13.0.19.1.tar.gz`    | `eab9d02d461035a4baded23d4f2e2834e5b17934820b79cea45baaf0c85383eb`                                  | equals the GitHub release asset digest; FFmpeg 9.0.2's `configure` accepts `ffnvcodec >= 12.1.14.0`                      |

- mpv 0.42.0's floor is FFmpeg 6.1 and libplacebo 7.387.0 (`RELEASE_NOTES`), and libcurl 7.88.0 for `stream_curl`. `sdl2-gamepad` defaults to `disabled` in `meson.options`, so the recipe enables it explicitly.
- Licensing (Q4a): FFmpeg is configured with `--enable-gpl`, never `--enable-nonfree`. It needs no `--enable-version3`, because it links no version-3 library. mpv is built with `-Dgpl=true` and `-Dlibmpv=false`. The bundle is a separate GPL program that harakiri runs over IPC.
- The host keeps only what `mpv/host-libs.txt` lists (Task 2). Everything else that mpv needs is copied into `lib/`, with RUNPATH `$ORIGIN/lib` on `mpv` and `$ORIGIN` on each library.
- Run every heavy process through `scripts/bounded.sh`. Tests: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 <paths>`. A local hook rejects vitest without `--maxWorkers`. The build runs as `scripts/bounded.sh mpv-build 6G -- podman build --memory 5g …`, because podman's build containers run outside the scope and need their own cap.
- `mise run check` needs no network once the bundle is in `.cache/mpv/<hash>`, as with the corpus. `client.test.ts`, `playback.local.test.ts` and `t1-mpv.test.ts` stay in the default tier. With no bundle they fail, and the error names `mise run mpv:build`. They never skip (`scripts/lint-skips.ts`).
- Secrets never reach mpv's argv. `playback.local.test.ts` reads the bundled mpv's real `/proc/<pid>/cmdline`. `--tls-ca-file=<path>` is not a secret.
- The Dependencies table in CLAUDE.md is pinned. Task 4 rewrites its video row with exactly the versions above.
- Exact copy:
  - `` harakiri's mpv build ${hash} is missing (${dir}): run `mise run mpv:build` ``
  - `No mpv/versions.env above ${from}`
  - `mpv:build needs podman (dnf install podman)`
  - `The server's certificate is not trusted`
- Commits are Conventional Commits, and each ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only the task's files.
- No home-directory paths, owner domains or library titles in tracked files (`scripts/lint-private.ts`). No platform names in feature code (`scripts/lint-host.ts`). The words "Fedora" and "Vulkan" are fine.
- CI: `.github/workflows/` has only `pr-title.yml` and `release.yml`. `release.yml` runs lint, `lint:skips`, `lint:private` and typecheck, and never runs tests. There is no CI check workflow, so this plan changes no workflow. Phase 8 adds the build to `release.yml`.

## Review Focus

1. **A packaged v0.1.x AppImage after this phase.** It has no checkout, so `bundledMpv()` cannot work there. Expected: it plays with `mpv` from `PATH`, as before, until Phase 8. Pinned in Task 5 (`resolveMpvBinary` with `packaged: true` never calls `bundled`).
2. **A recipe changed by a pull or a branch switch, with the old build still cached.** Expected: `bundledMpv()` throws and names `mise run mpv:build`. It never runs the old build. Pinned in Task 1.
3. **A build killed halfway, by the watchdog or Ctrl-C.** Expected: the `.partial` dir is never resolved, and the next `mpv:build` starts it again from clean. Pinned in Task 1 (the resolver ignores `<hash>.partial`) and Task 3 (the task removes it first).
4. **`HARAKIRI_MPV` set in the developer's shell while e2e or tests run.** Expected: the packages never read it, and e2e strips it, so both always run the bundle. Pinned in Task 5 (the e2e mpv child's `argv[0]` is `bundledMpv()`).
5. **A server whose certificate is valid.** TLS verification is on by default in 0.42. Expected: playback works, and HLS segments opened through FFmpeg also go over libcurl with the token header. Pinned in Task 6 (a trusted `--tls-ca-file` HLS play) and Task 3 (the bundle's CA bundle path exists on this host).

---

### Task 1: Find the build for this checkout by recipe hash

**Files:**

- Create: `mpv/versions.env`
- Create: `packages/mpv/src/bundle.ts`, `packages/mpv/src/bundle-dir.ts`
- Modify: `packages/mpv/src/index.ts` (export `bundledMpv`)
- Test: `packages/mpv/src/recipe.test.ts`

**Interfaces:**

- Produces:

```ts
// packages/mpv/src/bundle.ts
/** 16 hex digits over every file under recipeDir (see "The recipe hash"). */
export const recipeHash = (recipeDir: string): string;
/** The first directory at or above `from` that holds mpv/versions.env; throws `No mpv/versions.env above ${from}`. */
export const repoRootFrom = (from: string): string;
/** `<root>/.cache/mpv/<recipeHash(<root>/mpv)>`. It does not check that the dir exists. */
export const bundleDirIn = (root: string): string;
/** `<bundleDirIn(root)>/mpv`; throws the "is missing" copy when that file is absent. */
export const bundledMpvIn = (root: string): string;
/** bundledMpvIn(repoRootFrom(import.meta.dirname)), memoized. */
export const bundledMpv = (): string;
```

- `bun packages/mpv/src/bundle-dir.ts` prints `bundleDirIn(repoRootFrom(import.meta.dirname))` and a newline. `mpv:build` (Task 3) and Phase 8's `extraResources` use it.

- [ ] **Step 1: Write `mpv/versions.env`**

This is the exact content, with the values from Global Constraints. `fetch.sh` and the Containerfile read it with `set -a; . mpv/versions.env`.

```sh
# harakiri's mpv build. Every value is pinned. mpv/fetch.sh checks each sha256, and these URLs are
# the GPL source list a release links. Changing any file in mpv/ changes the recipe hash.
BASE_IMAGE=registry.fedoraproject.org/fedora:44@sha256:4f9a6c2f1eef83984ab0a2365fa99b3c080b0b028a02884c42f74ef8cb39e2fc
MPV_VERSION=0.42.0
MPV_URL=https://github.com/mpv-player/mpv/archive/refs/tags/v0.42.0.tar.gz
MPV_SHA256=bcfebbfa2b65a6d88dc97ea18117831072373e38b5785a2afb874ed4df5070dd
# GitLab's tag archive has no signature; the tag is commit 275f7dea27924cdd34ab2e6c20e448b6bc4fab65.
LIBPLACEBO_VERSION=7.387.0
LIBPLACEBO_URL=https://code.videolan.org/videolan/libplacebo/-/archive/v7.387.0/libplacebo-v7.387.0.tar.gz
LIBPLACEBO_SHA256=3bf5d72786682c194387c33d563872f6bfe202a9816f9dde6535a31a9b2e0d74
FFMPEG_VERSION=9.0.2
FFMPEG_URL=https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz
FFMPEG_SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
SDL2_VERSION=2.32.10
SDL2_URL=https://github.com/libsdl-org/SDL/releases/download/release-2.32.10/SDL2-2.32.10.tar.gz
SDL2_SHA256=5f5993c530f084535c65a6879e9b26ad441169b3e25d789d83287040a9ca5165
NV_CODEC_HEADERS_VERSION=13.0.19.1
NV_CODEC_HEADERS_URL=https://github.com/FFmpeg/nv-codec-headers/releases/download/n13.0.19.1/nv-codec-headers-13.0.19.1.tar.gz
NV_CODEC_HEADERS_SHA256=eab9d02d461035a4baded23d4f2e2834e5b17934820b79cea45baaf0c85383eb
```

- [ ] **Step 2: Write the failing tests**

Each test builds a fake checkout in a `mkdtemp` dir: `<root>/mpv/versions.env` and one more recipe file. `afterEach` removes it.

```ts
describe(recipeHash, () => {
  it("is 16 hex digits and ignores the order the files were written in", () => {
    // same two files written a→b in one root and b→a in another
    expect(recipeHash(first)).toMatch(/^[0-9a-f]{16}$/u);
    expect(recipeHash(first)).toBe(recipeHash(second));
  });
  it("changes when a byte changes, a file is renamed, or a file is added", () => {
    // three mutations of a copy, each compared with the original
  });
  it("does not change when only a file's mtime changes", () => {
    // utimesSync on one file
  });
});

it("repoRootFrom finds the checkout from a nested dir, and throws above any checkout", () => {
  expect(repoRootFrom(path.join(root, "a", "b"))).toBe(root);
  expect(() => repoRootFrom(bare)).toThrow(`No mpv/versions.env above ${bare}`);
});

it("bundledMpvIn returns the build for this recipe", () => {
  // touch <root>/.cache/mpv/<recipeHash(<root>/mpv)>/mpv
  expect(bundledMpvIn(root)).toBe(
    path.join(root, ".cache/mpv", recipeHash(path.join(root, "mpv")), "mpv")
  );
});

it("a missing build throws and names mise run mpv:build", () => {
  const hash = recipeHash(path.join(root, "mpv"));
  expect(() => bundledMpvIn(root)).toThrow(
    `harakiri's mpv build ${hash} is missing (${path.join(root, ".cache/mpv", hash)}): run \`mise run mpv:build\``
  );
});

it("a build for another recipe, or a partial one, is never used", () => {
  // <root>/.cache/mpv/0000000000000000/mpv and <root>/.cache/mpv/<hash>.partial/mpv both exist
  expect(() => bundledMpvIn(root)).toThrow("mise run mpv:build");
});

it("this checkout's build dir is under its own .cache/mpv", () => {
  const root = repoRootFrom(import.meta.dirname);
  expect(existsSync(path.join(root, "mpv/versions.env"))).toBe(true);
  expect(bundleDirIn(root)).toMatch(
    new RegExp(`^${escapeRegExp(root)}/\\.cache/mpv/[0-9a-f]{16}$`, "u")
  );
});
```

The last test needs no build. `escapeRegExp` comes from `es-toolkit`.

- [ ] **Step 3: Run the tests to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 packages/mpv/src/recipe.test.ts`
Expected: FAIL. `./bundle` does not exist.

- [ ] **Step 4: Implement `bundle.ts` and `bundle-dir.ts`**

`recipeHash` reads the files recursively with `readdirSync(dir, { recursive: true, withFileTypes: true })`, keeps regular files only, and sorts by relative path with POSIX separators. It uses `node:crypto` `createHash("sha256")`, as `packages/harness/src/corpus/fate.ts` does. `bundledMpv` keeps the resolved path in a module-level variable after the first success. It does not keep a failure, so a build that finishes later is found by the next call.

- [ ] **Step 5: Run the tests to see them pass, then `mise run typecheck` and `mise run lint`**

Expected: PASS. Also `bun packages/mpv/src/bundle-dir.ts` prints `<checkout>/.cache/mpv/<16 hex>`.

- [ ] **Step 6: Commit**

`feat(mpv): find harakiri's mpv build for this checkout by recipe hash`

---

### Task 2: Read what the build needs from the host

**Files:**

- Create: `mpv/host-libs.txt`
- Create: `packages/mpv/src/elf.ts`, `packages/mpv/src/host-libs.ts`
- Test: `packages/mpv/src/host-libs.test.ts`

**Interfaces:**

- Consumes: `repoRootFrom` (Task 1).
- Produces. Task 3's test, Task 7 and Phase 8's `scripts/check-release.ts` use these:

```ts
// packages/mpv/src/elf.ts
/** The DT_NEEDED sonames of an ELF64 little-endian file, in file order. Throws `${file} is not an ELF64 file`. */
export const neededLibs = (file: string): string[];

// packages/mpv/src/host-libs.ts
/** mpv/host-libs.txt: one soname pattern per line; `*` is the only wildcard; `#` starts a comment. */
export const readHostLibs = (recipeDir: string): string[];
export const isHostLib = (soname: string, patterns: readonly string[]): boolean;
/** `<path relative to bundleDir>: <soname>` for each need of `mpv` and of every file in `lib/` that is neither a file in lib/ nor a host lib. */
export const unbundledNeeds = (bundleDir: string, patterns: readonly string[]): string[];
```

- [ ] **Step 1: Write `mpv/host-libs.txt`**

These are the groups from Q3 and Q8, with the widening named under Decisions. `build.sh` (Task 3) matches with a bash `case`, and `isHostLib` matches the same `*` globs.

```text
# What harakiri's mpv takes from the host. Every other library mpv needs is copied into lib/.
# glibc
linux-vdso.so.1
ld-linux-x86-64.so.2
libc.so.6
libm.so.6
libmvec.so.1
libpthread.so.0
libdl.so.2
librt.so.1
libresolv.so.2
libutil.so.1
# The compiler runtime: the host's GPU driver loads it into the same process
libstdc++.so.6
libgcc_s.so.1
# Vulkan loader (it finds the compositor's implicit WSI layers)
libvulkan.so.1
# GPU driver: GLVND, GBM, DRM, VA-API, VDPAU
libEGL.so.1
libGL.so.1
libGLX.so.0
libGLdispatch.so.0
libOpenGL.so.0
libgbm.so.1
libdrm.so.2
libva.so.2
libva-drm.so.2
libva-wayland.so.2
libva-x11.so.2
libvdpau.so.1
# PipeWire and the sound stack
libpipewire-0.3.so.0
libpulse.so.0
libasound.so.2
# libwayland
libwayland-client.so.0
libwayland-cursor.so.0
libwayland-egl.so.1
libxkbcommon.so.0
# X11
libX11.so.6
libX11-xcb.so.1
libXext.so.6
libXrandr.so.2
libXss.so.1
libXpresent.so.1
libXinerama.so.1
libXrender.so.1
libXfixes.so.3
libXau.so.6
libXdmcp.so.6
libxcb*.so.*
```

- [ ] **Step 2: Write the failing tests**

```ts
it("neededLibs reads the DT_NEEDED entries of a real ELF", () => {
  expect(neededLibs(process.execPath)).toContain("libc.so.6");
});

it("neededLibs refuses a file that is not ELF64", () => {
  // a text file in a mkdtemp dir
  expect(() => neededLibs(text)).toThrow(`${text} is not an ELF64 file`);
});

it.each([
  ["libxcb-dri3.so.0", true],
  ["libX11.so.6", true],
  ["libva-drm.so.2", true],
  ["libva.so.3", false],
  ["libavcodec.so.62", false],
  ["libplacebo.so.351", false],
  ["libSDL2-2.0.so.0", false],
  ["libcurl.so.4", false],
])("isHostLib(%j) is %j against mpv/host-libs.txt", (soname, host) => {
  expect(isHostLib(soname, readHostLibs(recipe))).toBe(host);
});

it("readHostLibs skips comments and blank lines", () => {
  // "# x\n\nlibfoo.so.1\n" → ["libfoo.so.1"]
});

it("unbundledNeeds names each need that is neither in lib/ nor a host lib", () => {
  // <tmp>/mpv is a copy of process.execPath
  expect(unbundledNeeds(tmp, [])).toContain("mpv: libc.so.6");
  expect(unbundledNeeds(tmp, readHostLibs(recipe))).toStrictEqual([]);
});

it("a need satisfied by a file in lib/ is not reported", () => {
  // also copy process.execPath to <tmp>/lib/libc.so.6
  expect(unbundledNeeds(tmp, [])).not.toContain("mpv: libc.so.6");
});
```

`recipe` is `path.join(repoRootFrom(import.meta.dirname), "mpv")`.

- [ ] **Step 3: Run the tests to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 packages/mpv/src/host-libs.test.ts`
Expected: FAIL. The modules do not exist.

- [ ] **Step 4: Implement `elf.ts` and `host-libs.ts`**

The ELF reader works as follows. It checks `\x7fELF`, `EI_CLASS` 2 and `EI_DATA` 1. It reads `e_phoff` (offset 32, u64), `e_phentsize` (54) and `e_phnum` (56). It collects the `PT_LOAD` (1) program headers and the `PT_DYNAMIC` (2) one. In the dynamic segment, 16-byte entries are read until `DT_NULL`. `DT_NEEDED` (1) values are kept as string offsets, and `DT_STRTAB` (5) gives a virtual address. That address maps to a file offset through the `PT_LOAD` segment that contains it: `offset = p_offset + (vaddr - p_vaddr)`. Each name is the NUL-terminated string at `strtab + value`. A file with no `PT_DYNAMIC` returns `[]`. `isHostLib` turns each pattern into an anchored RegExp, with `*` mapped to `.*` and every other character escaped.

- [ ] **Step 5: Run the tests to see them pass, then `mise run typecheck` and `mise run lint`**

Expected: PASS.

- [ ] **Step 6: Commit**

`feat(mpv): read what the mpv build needs from the host`

---

### Task 3: Build the bundle in a pinned container, and check what it is

**Files:**

- Create: `mpv/Containerfile`, `mpv/build.sh`, `mpv/fetch.sh`
- Modify: `mise.toml` (new `mpv:build` task)
- Test: `packages/mpv/src/bundle.test.ts`

**Interfaces:**

- Consumes: `bundleDirIn`, `repoRootFrom`, `bundledMpv`, `bundle-dir.ts` (Task 1). `readHostLibs`, `unbundledNeeds` (Task 2).
- Produces: `.cache/mpv/<hash>/{mpv, lib/, manifest.json}` and `.cache/mpv/src/<tarballs>`. `manifest.json` is `{ "mpv": "0.42.0", "libplacebo": "7.387.0", "ffmpeg": "9.0.2", "sdl2": "2.32.10", "nvCodecHeaders": "13.0.19.1", "caBundle": "<curl-config --ca in the build image>" }`.

- [ ] **Step 1: Write the failing tests**

`bundle.test.ts` runs the real build. `run(...args)` is `execFileSync(bundledMpv(), ["--no-config", ...args], { encoding: "utf-8" })`. With no build, `bundledMpv()` throws the "is missing" copy, so the suite fails loudly and never skips.

```ts
it("is mpv 0.42.0 on libplacebo 7.387.0 and FFmpeg 9.0.2", () => {
  const version = run("--version");
  expect(version).toMatch(/^mpv v0\.42\.0 /mu);
  expect(version).toMatch(/^libplacebo version: v7\.387\.0$/mu);
  expect(version).toMatch(/^FFmpeg version: 9\.0\.2$/mu);
});

it("is configured with SDL2 gamepad input and the libcurl backend, and without libmpv (#13)", () => {
  const configuration =
    /Configuration: (?<flags>.*)$/mu.exec(run("-v", "--version"))?.groups?.flags ?? "";
  for (const flag of [
    "-Dsdl2-gamepad=enabled",
    "-Dlibcurl=enabled",
    "-Dlibmpv=false",
    "-Dgpl=true",
  ]) {
    expect(configuration).toContain(flag);
  }
});

it("has --input-gamepad, and verifies TLS by default", () => {
  const options = run("--list-options");
  expect(options).toMatch(/^\s*--input-gamepad\s/mu);
  expect(options).toMatch(/^\s*--tls-verify\s+Flag \(default: yes\)/mu);
});

it.each(["hevc", "h264", "vc1", "av1", "libdav1d"])("decodes video with %s", (decoder) => {
  expect(run("--vd=help")).toMatch(new RegExp(`^\\s*${decoder}\\s`, "mu"));
});

it.each(["truehd", "eac3", "dca", "ac3"])("decodes audio with %s", (decoder) => {
  expect(run("--ad=help")).toMatch(new RegExp(`^\\s*${decoder}\\s`, "mu"));
});

it.each(["vaapi", "nvdec", "vulkan"])("offers hwdec %s", (hwdec) => {
  expect(run("--hwdec=help")).toMatch(new RegExp(`^\\s*${hwdec}\\b`, "mu"));
});

it("needs nothing from the host beyond mpv/host-libs.txt", () => {
  expect(unbundledNeeds(path.dirname(bundledMpv()), readHostLibs(recipe))).toStrictEqual([]);
});

it("is FFmpeg under the GPL, never nonfree (Q4a)", () => {
  // the lib/libavcodec.so.* file, read as bytes: av_license() is compiled in as a string
  expect(avcodec.includes("GPL version 2 or later")).toBe(true);
  expect(avcodec.includes("nonfree and unredistributable")).toBe(false);
});

it("finds this host's CA bundle where its libcurl looks", () => {
  expect(existsSync(Manifest.parse(JSON.parse(readFileSync(manifest, "utf-8"))).caBundle)).toBe(
    true
  );
});
```

`Manifest` is a zod object for the shape above, because this is an IO edge. Two expectations are written from mpv's documentation and are not yet observed: the `--list-options` row format for `--tls-verify`, and the `--hwdec=help` row format. If the build prints them in another shape, change the regex to the observed line, but keep the asserted value (`yes`, and the hwdec name).

- [ ] **Step 2: Run the tests to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 packages/mpv/src/bundle.test.ts`
Expected: FAIL with `` harakiri's mpv build <hash> is missing (…): run `mise run mpv:build` ``.

- [ ] **Step 3: Write `mpv/fetch.sh <dest>`**

It sources `versions.env`. For each of the five components it downloads `<URL>` to `<dest>/<basename of URL>`, unless that file is already there with the right sha256. The download goes to a `.part` file. The script checks `sha256sum` against `<NAME>_SHA256`, then renames the file. On a mismatch it deletes the file and exits 1, naming the file and both hashes. It uses `curl -fsSL --retry 3`.

- [ ] **Step 4: Write `mpv/Containerfile`**

There are two stages. `build` is `FROM ${BASE_IMAGE}` (an `ARG`). It runs `dnf -y --disablerepo='*' --enablerepo=fedora --setopt=install_weak_deps=False install` with the list below, copies `build.sh`, `host-libs.txt` and `versions.env` to `/recipe/`, and runs `/recipe/build.sh` with `ARG JOBS`. The sources are bind-mounted read-only at `/src`. The second stage is `FROM scratch` with `COPY --from=build /out/ /`.

The dnf list: `gcc gcc-c++ make cmake meson ninja-build pkgconf nasm patchelf binutils python3 python3-jinja2 python3-markupsafe python3-glad2 vulkan-headers vulkan-loader-devel libshaderc-devel lcms2-devel libdav1d-devel zlib-ng-compat-devel bzip2-devel xz-devel libass-devel freetype-devel fribidi-devel harfbuzz-devel fontconfig-devel luajit-devel uchardet-devel zimg-devel libcurl-minimal libcurl-devel libva-devel libvdpau-devel libdrm-devel mesa-libgbm-devel mesa-libEGL-devel libglvnd-devel wayland-devel wayland-protocols-devel libxkbcommon-devel libX11-devel libXext-devel libXrandr-devel libXScrnSaver-devel libXpresent-devel libXinerama-devel pipewire-devel pulseaudio-libs-devel alsa-lib-devel systemd-devel`.

If a name is not in the Fedora 44 release repo, dnf fails with that name. Fix the name there, and do not enable `updates`.

- [ ] **Step 5: Write `mpv/build.sh`**

It runs with `set -euo pipefail`, prefix `/opt/harakiri`, `PKG_CONFIG_PATH=/opt/harakiri/lib64/pkgconfig:/opt/harakiri/lib/pkgconfig`, and `-j"$JOBS"`. It unpacks each tarball from `/src` into `/build`. The order and the options it pins:

1. nv-codec-headers: `make install PREFIX=/opt/harakiri`.
2. SDL2: CMake with `-DSDL_SHARED=ON -DSDL_STATIC=OFF -DSDL_VIDEO=OFF -DSDL_RENDER=OFF -DSDL_AUDIO=OFF -DSDL_JOYSTICK=ON -DSDL_HAPTIC=ON -DSDL_HIDAPI=ON -DSDL_LIBUDEV=ON -DSDL_TEST=OFF`.
3. FFmpeg: `--prefix=/opt/harakiri --enable-gpl --enable-shared --disable-static --disable-programs --disable-doc --enable-vulkan --enable-vaapi --enable-vdpau --enable-nvdec --enable-ffnvcodec --enable-libdrm --enable-libdav1d --disable-autodetect`, then the auto-detected libraries that are wanted, named explicitly: `--enable-zlib --enable-bzlib --enable-lzma --enable-iconv --enable-pthreads`. No `--enable-nonfree`, no `--enable-version3`, and no TLS library.
4. libplacebo: meson with `-Dvulkan=enabled -Dshaderc=enabled -Dglslang=disabled -Dlcms=enabled -Dopengl=enabled -Ddovi=enabled -Dlibdovi=disabled -Ddemos=false -Dtests=false`. The tarball's `3rdparty/` dirs are empty, so libplacebo uses the base image's Vulkan headers, `vk.xml`, jinja2 and glad2.
5. mpv: meson with `--auto-features=disabled -Dgpl=true -Dcplayer=true -Dlibmpv=false -Dtests=false -Dmanpage-build=disabled -Dhtml-build=disabled -Dsdl2-gamepad=enabled -Dlibcurl=enabled -Dlua=luajit -Diconv=enabled -Dlcms2=enabled -Dzimg=enabled -Duchardet=enabled -Dvulkan=enabled -Dshaderc=enabled -Dwayland=enabled -Dx11=enabled -Dxv=disabled -Dgl=enabled -Degl=enabled -Degl-wayland=enabled -Degl-x11=enabled -Ddrm=enabled -Dgbm=enabled -Dvaapi=enabled -Dvaapi-wayland=enabled -Dvaapi-x11=enabled -Dvaapi-drm=enabled -Dvdpau=enabled -Dcuda-hwaccel=enabled -Dcuda-interop=enabled -Dvulkan-interop=enabled -Dpipewire=enabled -Dpulse=enabled -Dalsa=enabled`. Lua is required, because e2e loads `hold-load.lua`. meson rejects an unknown option name, so a wrong one fails the build. Take the right name from mpv 0.42.0's `meson.options`.

Then it assembles `/out`:

- It copies `/opt/harakiri/bin/mpv` to `/out/mpv`.
- It walks `patchelf --print-needed` from `mpv` through every copied library. Each needed soname that `host-libs.txt` matches is left out. Every other soname is resolved with `ldconfig -p` or the prefix, copied to `/out/lib/<soname>` with symlinks dereferenced, and walked in turn.
- It runs `patchelf --set-rpath '$ORIGIN/lib'` on `mpv`, `patchelf --set-rpath '$ORIGIN'` on each library, and then `strip --strip-unneeded`.
- It writes `/out/manifest.json` from `versions.env` and `curl-config --ca`.
- Smoke test: `env -i /out/mpv --no-config --version`. A missing library fails the build here.

- [ ] **Step 6: Add the `mpv:build` task to `mise.toml`**

```toml
[tasks."mpv:build"]
description = "Build harakiri's mpv (mpv 0.42.0, libplacebo 7.387.0, FFmpeg 9.0.2, SDL2 2.32.10) into .cache/mpv/<recipe-hash>; a no-op when that build exists"
shell = "bash -euo pipefail -c"
run = """
out="$(bun packages/mpv/src/bundle-dir.ts)"
if [ -x "$out/mpv" ]; then echo "mpv build present: $out"; exit 0; fi
command -v podman >/dev/null || { echo 'mpv:build needs podman (dnf install podman)' >&2; exit 1; }
mpv/fetch.sh .cache/mpv/src
set -a; . mpv/versions.env; set +a
rm -rf "$out.partial"
scripts/bounded.sh mpv-build 6G -- podman build --memory 5g \
  --build-arg BASE_IMAGE="$BASE_IMAGE" --build-arg JOBS="${HARAKIRI_MPV_JOBS:-4}" \
  -v "$PWD/.cache/mpv/src:/src:ro,Z" -f mpv/Containerfile -o "type=local,dest=$out.partial" mpv
mv "$out.partial" "$out"
find .cache/mpv -mindepth 1 -maxdepth 1 -type d ! -name src ! -path "$out" -exec rm -rf {} +
echo "mpv build ready: $out"
"""
```

- [ ] **Step 7: Build, and run the tests to see them pass**

Run: `mise run mpv:build`, then the Step 2 command.
Expected: the build ends with `mpv build ready: …/.cache/mpv/<hash>`, and the tests PASS. A second `mise run mpv:build` prints `mpv build present: …` within a second. `mise run watchdog` in another terminal shows the build inside `harakiri.slice` and never prints `WATCHDOG KILLED`.

- [ ] **Step 8: Commit**

`build(mpv): build mpv 0.42.0, libplacebo 7.387.0, FFmpeg 9.0.2 and SDL2 2.32.10 in a pinned container`

---

### Task 4: Tests and the harness run the build, and setup needs no system mpv (#17)

**Files:**

- Modify: `packages/mpv/src/client.test.ts:40-47` (`start` passes `binary: bundledMpv()`), `client.test.ts:102-106` (0.42.0)
- Modify: `packages/harness/src/audio/mpv-capture.ts:23` (`bundledMpv()`), `packages/harness/src/audio/t1-mpv.test.ts:78-80` (the observation comment)
- Modify: `packages/harness/src/doctor.ts:68-80` (drop the mpv and libplacebo checks), the `podman` check (`required: true`)
- Modify: `packages/harness/src/doctor.test.ts`
- Modify: `mise.toml` (`setup`, `doctor` description), `README.md:59,75`, `CLAUDE.md`
- Test: `client.test.ts`, `doctor.test.ts`, `t1-mpv.test.ts`, `hbr.fate.test.ts`

**Interfaces:**

- Consumes: `bundledMpv()` from `@harakiri/mpv` (Task 1).
- Produces: nothing new. `MpvSpawnOptions.binary` stays optional here, because `playback.ts` passes none until Task 5, which makes it required.

- [ ] **Step 1: Write the failing tests**

```ts
// client.test.ts
it("talks to the real mpv 0.42.0", async () => {
  // as today, through start(), which now spawns bundledMpv()
  expect(version).toMatch(/^mpv v0\.42\.0 /u);
});

// doctor.test.ts
it("checks the harness tools only: no mpv, and podman is required", () => {
  expect(CHECKS.map((c) => c.label)).toStrictEqual([
    "ffmpeg filter libplacebo",
    "ffmpeg bitstream filter dovi_rpu",
    "ffmpeg encoders",
    "kwin_wayland",
    "weston",
    "podman",
    "dovi_tool",
    "hdr10plus_tool",
  ]);
  expect(CHECKS.find((c) => c.label === "podman")?.required).toBe(true);
});
```

The `versionAtLeast` judge tests in `doctor.test.ts` keep testing the judge, but with weston banners (`weston 15.0.0` passes and `weston 14.0.2` is outdated against `[15, 0, 0]`). Then no mpv banner is left in the file.

- [ ] **Step 2: Run the tests to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 packages/mpv/src/client.test.ts packages/harness/src/doctor.test.ts`
Expected: FAIL. The PATH mpv is 0.41, and `CHECKS` still lists mpv.

- [ ] **Step 3: Implement**

`start` in `client.test.ts` passes `binary: bundledMpv()`. The stand-in tests already pass `binary`. `captureWithMpv` runs `runToolOrThrow(bundledMpv(), …)`. `mise.toml`:

- `setup` runs `mise run mpv:build` before `mise run doctor`. On a machine without podman, setup then fails at `mpv:build` with its copy. A missing weston fails at doctor, which names it.
- `doctor`'s description becomes `Check the tools the validation harness needs: ffmpeg, the headless compositors, podman, dovi_tool and hdr10plus_tool`.

- [ ] **Step 4: Re-check the T1 sound tier on the bundle**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 packages/harness/src/audio`
Expected: PASS, with the bundle's FFmpeg 9.0.2 spdif muxer inside mpv compared byte for byte against the system `ffmpeg` 8.1.3 `-f spdif` reference. Update the comment at `t1-mpv.test.ts:78` to name "mpv 0.42.0 / FFmpeg 9.0.2 (the bundle), reference ffmpeg 8.1.3", after checking whether the E-AC-3 trailing-burst tolerance is still needed. If a byte comparison fails, that is a finding to report. Never loosen an assertion to make it pass. Then run `mise run media:fetch-fate && mise run test:fate`, which runs the same capture on the FATE samples.

- [ ] **Step 5: Update the docs**

- README line 59: the from-source requirements drop `mpv`, and keep `ffmpeg` from RPM Fusion "for the test harness".
- README line 75: the doctor row becomes "Checks the harness tools: ffmpeg, the headless compositors, podman, dovi_tool and hdr10plus_tool."
- README line 45, the release install text, stays until Phase 8.
- CLAUDE.md Onboarding: the Fedora package list drops `mpv (>= 0.41)`. `setup` "builds harakiri's mpv once (`mise run mpv:build`, cached in `.cache/mpv/<recipe-hash>`) and then runs `mise run doctor` to check the harness tools". RPM Fusion `ffmpeg` stays, "for the harness".
- CLAUDE.md "Bound every heavy process": add "the mpv build (`mise run mpv:build`, podman with `--memory`)".
- CLAUDE.md Dependencies, video row: `harakiri's mpv build (mpv/): mpv 0.42.0 + libplacebo 7.387.0 + FFmpeg 9.0.2 + SDL2 2.32.10; RPM Fusion ffmpeg 8.1.3 for the harness`.
- CLAUDE.md "Considered, rejected": replace "mpv master + libplacebo 7.387 now: deferred until we ship our own mpv build." with "System mpv for dev and tests: Fedora's build hid #13 (`sdl2-gamepad`), so dev, tests and e2e run harakiri's own build (Q12)."
- CLAUDE.md rule table, the offline row: the rule becomes "`mise run check` never needs a server, the NAS or the network once `mise run setup` has built the cached mpv (`.cache/mpv/<recipe-hash>`), like the corpus". Its enforcement becomes "Tier files are excluded from every package's default `vitest.config.ts`; `bundledMpv()` throws naming `mise run mpv:build` and never fetches".

- [ ] **Step 6: Run `mise run check`**

Expected: PASS, offline (the bundle from Task 3 is cached).

- [ ] **Step 7: Commit**

`test: run harakiri's mpv build in tests and the harness; setup needs no system mpv`

---

### Task 5: The desktop plays with harakiri's mpv, or `HARAKIRI_MPV`

**Files:**

- Create: `apps/desktop/src/main/player/mpv-binary.ts`
- Modify: `packages/mpv/src/client.ts:44-47` (`binary` required, doc comment), `client.ts:333` (`options.binary`, no `?? "mpv"`)
- Modify: `apps/desktop/src/main/env.ts` (`HARAKIRI_MPV`)
- Modify: `apps/desktop/src/main/player/create-player.ts:18-37` (`PlayerWiring.mpvBinary`), `create-player.ts:80-95` (`deps()` sets `mpvBinary`)
- Modify: `apps/desktop/src/main/player/index.ts` (passes `mpvBinary`)
- Modify: `apps/desktop/src/main/player/playback.ts:77-88` (`PlaybackDeps.mpvBinary`), `playback.ts:316-321` (log line, `binary`)
- Modify: every `PlaybackDeps` literal (`grep -rn 'hdrSignalling: "' apps/desktop/src`): `playback.local.test.ts`, `player.live.test.ts`, `create-player.test.ts`
- Modify: `apps/desktop/e2e/support/mpv.ts` (`MpvProcess.binary`, `lavapipeDeviceUuid`), `e2e/support/harakiri.ts` (drop `HARAKIRI_MPV`), `e2e/support/global-setup.ts`, `e2e/player.headless.spec.ts`
- Modify: `mise.toml` (`dev` and `e2e` get `depends = ["mpv:build"]`)
- Test: `apps/desktop/src/main/player/mpv-binary.test.ts`, `create-player.test.ts`, `playback.local.test.ts`, `mise run e2e`

**Interfaces:**

- Consumes: `bundledMpv()` (Task 1). Every package test already passes `binary` (Task 4).
- Produces: `MpvSpawnOptions.binary: string` (required), documented as "Path to the mpv executable: `bundledMpv()` in tests, `mpvBinary()` in the app." Phase 8 changes only `resolveMpvBinary`'s packaged branch and adds `resourcesPath` to `MpvBinarySources`:

```ts
// apps/desktop/src/main/player/mpv-binary.ts
export interface MpvBinarySources {
  /** HARAKIRI_MPV: a developer's mpv, e.g. a build of mpv master. */
  readonly override: string | undefined;
  readonly packaged: boolean;
  readonly bundled: () => string;
}
/** override ?? (packaged ? "mpv" : bundled()). Phase 8: packaged → <resourcesPath>/mpv/mpv. */
export const resolveMpvBinary = (sources: MpvBinarySources): string;
export const mpvBinary = (): string; // resolveMpvBinary({ override: env.HARAKIRI_MPV, packaged: app.isPackaged, bundled: bundledMpv })

// create-player.ts
PlayerWiring.mpvBinary: () => string;
// playback.ts
PlaybackDeps.mpvBinary: string;
// e2e/support/mpv.ts
MpvProcess.binary: string; // argv[0]
```

- `env.ts` gains `HARAKIRI_MPV: z.string().min(1).optional()`, with the doc comment `/** A developer's mpv instead of harakiri's build, e.g. to try mpv master. e2e never passes it. */`.
- `startPlayback` logs `logger.info("Starting mpv {binary}", { binary: deps.mpvBinary })` right before `spawnMpv`, so the run log names the binary.

- [ ] **Step 1: Write the failing tests**

```ts
// mpv-binary.test.ts
it("HARAKIRI_MPV wins, packaged or not, and the build is never looked up", () => {
  const bundled = vi.fn(() => "/checkout/.cache/mpv/0123456789abcdef/mpv");
  expect(resolveMpvBinary({ override: "/opt/mpv-git/mpv", packaged: false, bundled })).toBe(
    "/opt/mpv-git/mpv"
  );
  expect(resolveMpvBinary({ override: "/opt/mpv-git/mpv", packaged: true, bundled })).toBe(
    "/opt/mpv-git/mpv"
  );
  expect(bundled).not.toHaveBeenCalled();
});

it("a packaged app keeps mpv from PATH until it ships its own (Phase 8)", () => {
  const bundled = vi.fn(() => "/never");
  expect(resolveMpvBinary({ override: undefined, packaged: true, bundled })).toBe("mpv");
  expect(bundled).not.toHaveBeenCalled();
});

it("dev, tests and e2e run the checkout's build", () => {
  expect(resolveMpvBinary({ override: undefined, packaged: false, bundled: () => "/b/mpv" })).toBe(
    "/b/mpv"
  );
});

// create-player.test.ts
it("play hands the wiring's mpv binary to the playback it starts", async () => {
  // wiring.mpvBinary: () => "/b/mpv"
  expect(startPlayback.mock.calls[0]?.[2]).toMatchObject({ mpvBinary: "/b/mpv" });
});

// playback.local.test.ts: mpvChild() keeps argv[0]
it("the mpv that plays is harakiri's build", async () => {
  // during play
  expect(mpvChild().cmdline.split("\0")[0]).toBe(bundledMpv());
});
```

In `player.headless.spec.ts`, next to the existing `toHaveLength(1)` at line 195, add `expect(mpvProcesses(userDataDir)[0]?.binary).toBe(bundledMpv())`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/player/mpv-binary.test.ts apps/desktop/src/main/player/create-player.test.ts apps/desktop/src/main/player/playback.local.test.ts`
Expected: FAIL. `mpv-binary.ts` does not exist, and `spawnMpv` gets no `binary`, which typecheck also reports.

- [ ] **Step 3: Implement**

The wiring follows the "Host data enters through wiring" pattern (design doc). `player/index.ts` passes `mpvBinary`. `deps()` in `create-player.ts` adds `mpvBinary: wiring.mpvBinary()`. `playback.ts` passes `binary: deps.mpvBinary`. The e2e support changes:

- `lavapipeDeviceUuid` runs `execFileSync(bundledMpv(), ["--no-config", "--vulkan-device=help"], …)`.
- `mpvProcesses` records `binary: argv[0] ?? ""`.
- `harakiri.ts` adds `"HARAKIRI_MPV"` to `dropped`.
- `globalSetup` calls `bundledMpv()` first, so a missing build fails the run before Jellyfin starts, with the "is missing" copy.
- `mise.toml`'s `dev` and `e2e` tasks get `depends = ["mpv:build"]`, which is a no-op when the build exists.

- [ ] **Step 4: Run the tests to see them pass, then `mise run check`**

Expected: PASS. The existing "the token and the ApiKey sidecar never reach mpv's argv" test passes on the bundled mpv's real cmdline.

- [ ] **Step 5: Run e2e on 0.42, and re-check the picture and passthrough expectations (Q4, Q7)**

Run: `mise run e2e`
Expected: every spec passes, including `player.hdr.spec.ts` and `player.passthrough.spec.ts`. Three expectations change meaning on 0.42 + 7.387. Read each one from the spec's `picture` attachment before changing anything:

- `/reshap/iu` on `vo-passes` for Dolby Vision profile 5 (T2). libplacebo 7.387 changes DV reshaping for profiles 5 and 8. If the pass is renamed, replace the regex with the new pass's literal name, and keep HDR10 asserting its absence. A DV 5 play with no reshaping pass at all is a regression to report, not an expectation to edit.
- `displaySdr` and `tone-mapped to SDR` under KWin virtual. 0.42 sends Wayland HDR through the colour-management protocol. If KWin's virtual output now gets a PQ target, that is a fidelity change, so stop and report it with the attachment. Do not edit the scenario.
- The passthrough spec's `spdif-*` formats. These should be unchanged.

Any expectation edit carries a one-line comment naming mpv 0.42.0 / libplacebo 7.387.0. Add the before and after values to the commit body.

- [ ] **Step 6: Commit**

`feat(desktop): play with harakiri's mpv build, or HARAKIRI_MPV`

---

### Task 6: An untrusted server certificate ends the play with a sentence (Q4)

**Files:**

- Create: `apps/desktop/src/main/player/tls.ts`
- Modify: `apps/desktop/src/main/player/playback.ts:637-665` (the `end-file` handler), `playback.ts:721-735` (the `log-message` handler)
- Modify: `apps/desktop/src/main/player/playback.local.test.ts` (an https server, a `transcodingUrl` knob on `FakeJellyfin.playbackInfo`)
- Test: `apps/desktop/src/main/player/tls.test.ts`, `playback.local.test.ts`

**Interfaces:**

- Consumes: `PlaybackDeps.mpvBinary` (Task 5), the bundle's libcurl with `--tls-verify` on (Task 3).
- Produces:

```ts
// apps/desktop/src/main/player/tls.ts
export const CERTIFICATE_NOT_TRUSTED = "The server's certificate is not trusted";
/** True for mpv's log line when libcurl refused the server's certificate. */
export const isCertificateRejection = (line: { readonly prefix: string; readonly level: string; readonly text: string }): boolean;
```

- In `run`, a `log-message` for which `isCertificateRejection` is true sets `certificateRejected`. A later `end-file` with `reason: "error"` then calls `fail(CERTIFICATE_NOT_TRUSTED)` instead of `` `mpv could not play the file: …` ``.

- [ ] **Step 1: Record mpv's line**

In a scratch dir, generate a self-signed cert:

```sh
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 1 -subj /CN=127.0.0.1 -addext subjectAltName=IP:127.0.0.1 -keyout key.pem -out cert.pem
```

Serve it with `openssl s_server -accept 8443 -cert cert.pem -key key.pem -www`. Then run `"$(bun packages/mpv/src/bundle-dir.ts)/mpv" --no-config --vo=null --ao=null --msg-level=all=v https://127.0.0.1:8443/`. Copy the line that names the certificate, with its `[prefix]` and level, into `tls.test.ts` as the fixture. libcurl's wording for this error is "SSL certificate problem: self-signed certificate". Its `curl_easy_strerror(60)` is "SSL peer certificate or SSH remote key was not OK". Match whichever one the bundle prints.

- [ ] **Step 2: Write the failing tests**

```ts
// tls.test.ts
it("mpv's line for a refused certificate is a rejection", () => {
  expect(isCertificateRejection(RECORDED)).toBe(true); // the Step 1 line
});
it.each([
  { prefix: RECORDED.prefix, level: "error", text: "HTTP error 404" },
  { prefix: "ffmpeg", level: "warn", text: "Invalid data found when processing input" },
])("an unrelated failure is not: %j", (line) => {
  expect(isCertificateRejection(line)).toBe(false);
});

// playback.local.test.ts. A node:https server on 127.0.0.1:0 with the openssl cert from beforeAll.
it("a server certificate mpv does not trust ends the play with the sentence", async () => {
  // FakeJellyfin.transcodingUrl = https://127.0.0.1:<port>/hls/master.m3u8
  const error = events.findLast((e) => e.phase === "error");
  expect(error?.error).toBe("The server's certificate is not trusted");
});
it("with the certificate trusted, HLS over https plays to its end and every request carries the token", async () => {
  // extraArgs adds --tls-ca-file=<cert.pem>; ffmpeg -f hls cuts the clip into master.m3u8 + segments
  expect(events.at(-1)?.phase).toBe("ended");
  expect(https.requests.map((r) => r.url)).toEqual(
    expect.arrayContaining(["/hls/master.m3u8", expect.stringMatching(/\.ts$/u)])
  );
  expect(https.requests.every((r) => r.authorized)).toBe(true);
});
```

The https server records `authorized` the way `FakeJellyfin` does (`playback.local.test.ts:109`: the `authorization` header includes `Token="${TOKEN}"`), and answers 401 otherwise. The second test is the Q4 re-check of `http-header-fields` over the libcurl backend, including FFmpeg's nested HLS opens. The cert is generated with the `openssl` CLI into the test's `mkdtemp` dir, so nothing secret is committed.

- [ ] **Step 3: Run the tests to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/player/tls.test.ts apps/desktop/src/main/player/playback.local.test.ts`
Expected: FAIL. `tls.ts` does not exist, and the play ends with `mpv could not play the file: loading failed`.

- [ ] **Step 4: Implement `isCertificateRejection` and the mapping**

The match is the recorded line's prefix family (`startsWith`) plus `/certificate/iu` on the text, at level `error` or `fatal`. The `log-message` subscription already requests `warn` and above (`playback.ts:736`).

- [ ] **Step 5: Run the tests to see them pass, then `mise run check`**

Expected: PASS.

- [ ] **Step 6: Commit**

`feat(player): say when the server's certificate is not trusted`

---

### Task 7: The guest runs harakiri's mpv, not Fedora's (#13) — needs Phase 4 merged

**Files:**

- Modify: `dev/vm/provision.sh` (drop `mpv`, add the host libraries)
- Modify: `packages/mpv/src/gamepad.platform.test.ts` (Phase 4's test)
- Create: `packages/mpv/src/bundle.platform.test.ts`
- Test: `mise run test:platform`

**Interfaces:**

- Consumes: `bundledMpv()` (Task 1), `readHostLibs`, `neededLibs` (Task 2). From Phase 4: the `platform` tier, `mise run test:platform`, `dev/vm/guest.sh exec`, and the guest's `/workspace` mount of the worktree, which also carries `.cache/mpv/<hash>`. A platform test outside the guest throws and names `mise run test:platform` (Phase 4's rule).

- [ ] **Step 1: Write the failing tests**

```ts
// bundle.platform.test.ts
it("every host library the build needs resolves in the guest", () => {
  const ldd = execFileSync("ldd", [bundledMpv()], { encoding: "utf-8" });
  expect(ldd.split("\n").filter((line) => line.includes("not found"))).toStrictEqual([]);
});
it("runs in the guest with only the guest's own libraries", () => {
  expect(
    execFileSync(bundledMpv(), ["--no-config", "--version"], { encoding: "utf-8", env: {} })
  ).toMatch(/^mpv v0\.42\.0 /mu);
});

// gamepad.platform.test.ts: Phase 4's test, with the binary replaced
// binary: bundledMpv() instead of Fedora's mpv
expect(exit.code).toBe(42);
expect(log).toMatch(/added controller: /u);
```

- [ ] **Step 2: Change `dev/vm/provision.sh`**

Drop `mpv` from the dnf list. Name the host side of `mpv/host-libs.txt` explicitly, because mpv's package no longer pulls it in: `vulkan-loader mesa-vulkan-drivers mesa-libEGL mesa-libgbm libglvnd-egl libglvnd-glx libglvnd-opengl libdrm libva libvdpau pipewire-libs pulseaudio-libs alsa-lib libwayland-client libwayland-cursor libwayland-egl libxkbcommon libX11 libX11-xcb libXext libXrandr libXScrnSaver libXpresent libXinerama libXrender libXfixes libxcb libstdc++ libgcc`. The guest's provision cache is keyed by Phase 4's own rule. If that key does not cover `provision.sh`, run `dev/vm/guest.sh down` and remove `.cache/vm` once, so the guest is provisioned again without Fedora's mpv.

- [ ] **Step 3: Run the platform tier**

Run: `mise run mpv:build && mise run test:platform`
Expected: PASS. The `ldd` test proves that the dnf list covers the allowlist, and the pad press reaches the build's SDL2 gamepad (exit 42). Then confirm that the guest has no Fedora mpv: `dev/vm/guest.sh exec -- sh -c 'command -v mpv || echo none'` prints `none`.

- [ ] **Step 4: Run e2e in the guest**

Run: `mise run e2e`. After Phase 4 this runs inside the guest.
Expected: PASS on the bundle. `player.headless.spec.ts` asserts `argv[0]` is `bundledMpv()` (Task 5).

- [ ] **Step 5: Commit**

`test(vm): the guest runs harakiri's mpv build`

---

## Validation (the outline's Phase 7 list)

- `mise run mpv:build`, then `"$(bun packages/mpv/src/bundle-dir.ts)/mpv" -v --version` shows `-Dsdl2-gamepad=enabled` (Task 3's test asserts it).
- `mise run check`, offline.
- `scripts/bounded.sh local 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/player/playback.local.test.ts`: secrets are still absent from the real cmdline, the token travels over libcurl, and the TLS sentence appears.
- `mise run test:platform` (Task 7).
- `mise run e2e`, including `player.hdr.spec.ts` and `player.passthrough.spec.ts` on 0.42.
- In the guest, which has no system mpv and no weston: `dev/vm/guest.sh exec -- bun run --filter @harakiri/harness doctor` exits 1, names only the harness tools the guest lacks, and names no mpv.

Manual, on the dev box:

- `HARAKIRI_MPV=/usr/bin/mpv mise run dev` plays with the developer's mpv, and the run log has `Starting mpv /usr/bin/mpv`.

Manual, on the HTPC, recorded in Phase 11's `htpc:check` (none of these can be checked here):

- `hwdec-current` is `nvdec` with `hwdec=auto-safe` on 0.42, now that Vulkan hwdec has left `auto-safe` (Q4).
- Under gamescope, 0.42 falls back to `x11vk`, and the `yes` hint gets the HDR10 formats (Q7).

## What Phase 8 takes from this plan

- `bun packages/mpv/src/bundle-dir.ts`: the dir that electron-builder's `extraResources` copies to `resources/mpv/`.
- `resolveMpvBinary`'s packaged branch: replace `"mpv"` with `path.join(resourcesPath, "mpv", "mpv")`, and add `resourcesPath` to `MpvBinarySources`.
- `neededLibs`, `readHostLibs`, `unbundledNeeds` for `scripts/check-release.ts`'s check that everything outside the bundle is on `mpv/host-libs.txt`. The `-v`, `--list-options`, `--vd=help` and `--ad=help` assertions in `bundle.test.ts` are the ones to repeat on the extracted AppImage.
- `mpv/versions.env` URLs and `.cache/mpv/src/` tarballs: the GPL source list and the files to upload.
- `mise run mpv:build` for the release job, which is cached by the same hash. `mpv:fetch` by hash is Phase 8's.
