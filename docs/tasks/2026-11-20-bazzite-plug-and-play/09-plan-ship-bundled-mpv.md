---
task: 2026-11-20-bazzite-plug-and-play
type: plan
repo: harakiri
branch: tcorzo/bazzite-8-plan
sha: ae6a0e0
---

**Repos touched:** `harakiri`

# Bazzite plug and play, part 5: the AppImage ships the bundled mpv — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user installs one AppImage and nothing else. It plays with harakiri's own mpv from `resources/mpv/`, finds the host's trusted certificates on any supported distro, and ships every license, notice and corresponding source its bundled code needs (#2, #14).

**Architecture:** The recipe keeps building into `.cache/mpv/<recipe-hash>/`. It now takes OpenSSL from the host and lets the host's OpenSSL find the host's trust store. It also writes the bundle's license texts and source list next to `mpv`. `mise run package` stages that directory as electron-builder `extraResources`, `resolveMpvBinary` points a packaged app at it, and the app starts mpv with no inherited library path. `package:check` proves the shipped bundle at release time, and `release.yml` builds the recipe (cached by hash) and uploads the corresponding source.

**Tech Stack:** podman, meson, CMake (curl), patchelf, rpm, bun scripts, TypeScript 7, vitest 5 (`--maxWorkers=2`), electron-builder 26 (`extraResources`), Vite 8 (`build.license`), GitHub Actions (`actions/cache`), `gh release upload`.

**Spec:** `docs/tasks/2026-11-20-bazzite-plug-and-play/03-structure-outline-bazzite-plug-and-play.md`, Phase 8 and its "Host libraries the GPU drivers share". The owner decisions of 2026-11-22 recorded in `.superpowers/sdd/07-plan-bundled-mpv/progress.md`. `docs/research/08-shipping-third-party-licenses.md` for licenses and source. `02-design-discussion-bazzite-plug-and-play.md` (Q4a, Q8). The outline wins where they differ, and the owner decisions win over the outline.

**Not in this plan:** the Dolby Vision 7 enhancement layer (Phase 9). The Steam Game Mode docs and the HTPC checklist (Phase 11). An in-app "licenses" screen.

**Depends on:** plans 06, 07 and 08 (merged, `main` at `ae6a0e0`).

## Owner decisions this plan implements (2026-11-22)

1. `libssl.so.3` and `libcrypto.so.3` come from the host, so the distro patches OpenSSL.
2. The mpv bundle conveys as GPLv3: mpv and FFmpeg are GPLv2-or-later, and the Apache-2.0 code linked into the same process (shaderc, glslang, SPIRV-Tools) is compatible with GPLv3 only. harakiri stays MIT: mpv is a separate program that harakiri talks to over IPC.
3. License texts, notices and corresponding source follow established prior art (`docs/research/08-shipping-third-party-licenses.md`), not a scheme of our own.
4. The certificate path stops being Fedora's. See the first decision below: it is met without a new host capability. The owner approved this revision on 2026-11-22.
5. The glibc and libstdc++ floor stays the Fedora 44 build base. Bazzite, Fedora and Arch are supported; older Ubuntu LTS is not.

## Decisions this plan makes beyond the outline

- **The host's OpenSSL finds the host's trust store; no host capability is needed (decision 4).** Once `libssl` comes from the host (decision 1), the host's own OpenSSL knows where its distro keeps the trusted certificates: `OPENSSLDIR` is compiled into it (`/etc/pki/tls` on Fedora and Bazzite, `/usr/lib/ssl` on Debian, `/etc/ssl` on Arch), and it honours `SSL_CERT_FILE` and `SSL_CERT_DIR`. curl calls it with `X509_STORE_set_default_paths` when it is built with `CURL_CA_BUNDLE=none CURL_CA_PATH=none CURL_CA_FALLBACK=ON`, and logs `OpenSSL default paths (fallback)` (curl 8.23.0 `lib/vtls/openssl.c`). Every program that links the system's OpenSSL does this. A host capability would instead mean keeping our own list of distro paths in `host/`, which the host's OpenSSL already knows. `manifest.json` drops `caBundle`. `--tls-ca-file` still overrides it, as the tests already use.
- **curl drops GSS-API.** No Jellyfin setup authenticates with Kerberos, and GSS-API is what pulls `libkrb5`, `libgssapi_krb5`, `libk5crypto`, `libkrb5support`, `libkeyutils` and `libcom_err` into `lib/`. `-DCURL_USE_GSSAPI=OFF` and `krb5-devel` leaves the Containerfile. That is six fewer libraries to license, and six fewer to load into the process the host's GPU driver shares.
- **No `mpv:fetch`.** The outline's task to download the release job's bundle by hash has no user: developers build once with `mise run setup`, and the release job builds or restores its own cache. Dropped.
- **The packaged bundle is staged, not referenced by hash.** electron-builder's config is static YAML and the bundle directory's name changes with the recipe. `mise run package` now depends on `mpv:build` and copies `.cache/mpv/<hash>/` to `.cache/package/mpv/`, which `extraResources` packs as `resources/mpv/`. `.cache/` is already ignored by git.
- **mpv starts with no inherited library path.** electron-builder's `AppRun` exports `LD_LIBRARY_PATH="${APPDIR}/usr/lib:$LD_LIBRARY_PATH"`, and Steam starts non-Steam shortcuts with its runtime's library dirs in `LD_LIBRARY_PATH`. The bundle's `$ORIGIN/lib` is a `DT_RUNPATH`, which the loader searches after `LD_LIBRARY_PATH`. So an older `libSDL2-2.0.so.0` or `libcurl.so.4` from the Steam runtime would replace the bundle's own copy. `spawnMpv` takes an `env`, and the app passes its environment without `LD_LIBRARY_PATH` and `LD_PRELOAD`. `HARAKIRI_MPV` keeps the full environment: a developer's mpv may need it.
- **The release job checks the bundle it ships, not one it trusts.** `package:check` reads `resources/mpv/` out of the built AppImage, not `.cache/mpv`.
- **A dry run of the release job.** `release.yml`'s `workflow_dispatch` gets a `dry-run` input. A dry run builds and checks the dispatched ref, then uploads the AppImage and the source as workflow artifacts instead of to a release. This is how the job is tested before a real release.

## Global Constraints

- Every heavy process runs through `scripts/bounded.sh`; vitest always gets `--maxWorkers=2`, Playwright `--workers=1`; podman gets `--memory`.
- Tests never skip, and they assert literal values. A test that needs the bundle fails naming `mise run mpv:build`.
- `mise run check` needs no network once `.cache/mpv/<hash>` exists.
- Secrets never go in mpv's argv.
- No workstation paths, owner domains or library titles in tracked files (`lint:private`).
- No feature code names a platform (`lint:host`).
- No hook is bypassed with `HK=0`; a misfiring hook is fixed in its config.
- Never `mise run dev`. e2e never opens a window on the owner's desktop.
- A recipe change gives a new hash, so every task that edits `mpv/` runs `mise run mpv:build` before its tests.
- Commits are Conventional Commits.

## Review Focus

1. **A Steam-launched AppImage, with Steam runtime libraries in `LD_LIBRARY_PATH`.** mpv must still load its own `lib/`. Task 4 pins this with a decoy library dir.
2. **A host whose OpenSSL is older than the one the build compiled against.** The loader must resolve every `OPENSSL_3.x` symbol version the bundle needs (today's libcurl needs up to `OPENSSL_3.2.0`). Task 6 runs `ldd` on the Bazzite and Arch images, which names a missing version.
3. **https on a distro that is not Fedora.** The bundle must trust what that distro trusts, with no Fedora path anywhere in it. Task 1 proves the fallback on the host's OpenSSL, and Task 6 checks it on Arch.
4. **A bundle that drifts from its licenses.** A new library in `lib/` with no license text must fail the build and the check, not ship. Task 2 pins it.
5. **An AppImage built from a stale bundle.** The staged bundle must be the current recipe hash, or `package` fails. Task 3 pins it.

---

### Task 1: The bundle takes OpenSSL from the host, and trusts what the host trusts

**Files:**

- Modify: `mpv/host-libs.txt` (an OpenSSL group: `libssl.so.3`, `libcrypto.so.3`, with the reason: the distro patches it, and its `OPENSSLDIR` names the distro's trust store)
- Modify: `mpv/build.sh` (curl's CMake line; `manifest.json` loses `caBundle`)
- Modify: `mpv/Containerfile` (drop `krb5-devel`; its comment says why curl has no GSS-API)
- Modify: `packages/mpv/src/bundle.test.ts`, `packages/mpv/src/curl-tls.test.ts`
- Modify: `CLAUDE.md` ("Considered, rejected": a CA path compiled into the bundle, and a host capability listing distro CA paths), `03-structure-outline-bazzite-plug-and-play.md` (the CA bullet under Phase 8 is resolved, pointing at this plan)

**Interfaces:**

- Produces: `manifest.json` without `caBundle`. `lib/` with no `libssl`, `libcrypto`, `libkrb5`, `libgssapi_krb5`, `libk5crypto`, `libkrb5support`, `libkeyutils` or `libcom_err`. Task 2 lists components from this `lib/`.

- [ ] **Step 1: Write the failing tests**

In `bundle.test.ts`, replace "finds this host's CA bundle where its libcurl looks" and drop `caBundle` from `Manifest` (make it `.strict()` so a leftover key fails):

```ts
it("takes OpenSSL from the host, and ships no Kerberos (curl has no GSS-API)", () => {
  const shipped = readdirSync(bundleFile("lib"));
  expect(
    shipped.filter((f) =>
      /^lib(?:ssl|crypto|krb5|gssapi_krb5|k5crypto|krb5support|keyutils|com_err)\.so/u.test(f)
    )
  ).toEqual([]);
  expect(neededLibs(bundleFile("lib/libcurl.so.4")).toSorted()).toEqual([
    "libc.so.6",
    "libcrypto.so.3",
    "libidn2.so.0",
    "libnghttp2.so.14",
    "libssl.so.3",
    "libz.so.1",
  ]);
});
```

The `neededLibs` list is the expected value after the change. If the real build differs only by a glibc soname, the implementer corrects the literal and says so in the report. Any other difference is a finding.

In `curl-tls.test.ts`, `play` takes `env` (default: `process.env` without `SSL_CERT_FILE` and `SSL_CERT_DIR`). Drop the `caBundle()` helper, and replace the first test with these two. Keep the `--tls-ca-file` test as it is.

```ts
it("refuses a certificate the host does not trust, asking the host's OpenSSL for its trust store", async () => {
  const { code, log } = await play({}, "--msg-level=curl=trace");
  expect(code).not.toBe(0);
  expect(log).toContain("[curl] TLS certificate verification failed.");
  expect(log).toContain("OpenSSL default paths (fallback)");
  expect(log).not.toContain("CAfile:");
});

it("trusts what the host's OpenSSL is told to trust (SSL_CERT_FILE), with no --tls-ca-file", async () => {
  const { code, log } = await play({ SSL_CERT_FILE: CERT });
  expect(log).toContain("Exiting... (End of file)");
  expect(code).toBe(0);
});
```

- [ ] **Step 2: Run them against today's bundle and see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 packages/mpv/src/bundle.test.ts packages/mpv/src/curl-tls.test.ts`
Expected: FAIL. `lib/` still holds `libssl.so.3`, the manifest still has `caBundle`, and the log says `CAfile: /etc/pki/...`.

- [ ] **Step 3: Change the recipe**

curl's CMake line: `-DCURL_USE_GSSAPI=OFF -DCURL_CA_BUNDLE=none -DCURL_CA_PATH=none -DCURL_CA_FALLBACK=ON`. Then `mise run mpv:build`. The new hash builds, and the old hash dir is removed.

- [ ] **Step 4: Run the tests until they pass, then the rest of the bundle's tests**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 packages/mpv`
Expected: PASS, including `vulkan.test.ts` and `bundle.test.ts`'s "needs nothing from the host beyond mpv/host-libs.txt".

Run: `mise run test:platform`. Expected: PASS. The guest's Fedora OpenSSL now serves the bundle.

Run: `scripts/bounded.sh local 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/player/playback.local.test.ts`. Expected: PASS. A self-signed server still gives "The server's certificate is not trusted".

- [ ] **Step 5: Commit**

`build(mpv): take OpenSSL from the host and trust the host's certificate store`

---

### Task 2: The bundle carries its licenses and its source list

This follows `docs/research/08-shipping-third-party-licenses.md`. Each component's license files go in their own directory, the Flathub layout (`share/licenses/<component>/`). The source follows FFmpeg's legal checklist and GPLv3 §6(d). License text comes only from the component itself: the pinned tarball for what we build, and `rpm -qL` for what we copy from Fedora. We write none of it.

**Files:**

- Modify: `mpv/build.sh`. It writes `licenses/`, `SOURCES.txt` and `BUILDING.txt`, and adds `components` to `manifest.json`.
- Create: `mpv/licenses-README.txt`. This is the only text we write ourselves: the bundle is conveyed under GPLv3, mpv is a separate program that harakiri runs, and the source is the `harakiri-mpv-source-<tag>.tar` asset on the same GitHub release. `build.sh` copies it to `licenses/README`.
- Create: `packages/mpv/src/licenses.ts`, `packages/mpv/src/licenses.test.ts`
- Modify: `packages/mpv/src/bundle.test.ts`

**Interfaces:**

- Produces, in the bundle (and so in `resources/mpv/`):
  ```text
  manifest.json   + components: Component[]
  licenses/README
  licenses/COPYING.GPLv3                     from FFmpeg's tarball
  licenses/<component>/<file>...             e.g. licenses/ffmpeg/COPYING.GPLv2, licenses/harfbuzz/COPYING
  SOURCES.txt     one line per component: name, version, license (SPDX), then the url and sha256, or the SRPM
  BUILDING.txt    FFmpeg's configure line, libplacebo's and mpv's meson lines, curl's CMake line
  ```
- Produces, in `packages/mpv/src/licenses.ts`:
  ```ts
  export interface Component {
    readonly name: string;           // directory under licenses/
    readonly version: string;
    readonly license: string;        // SPDX: Fedora's %{LICENSE}, or the recipe's for what it builds
    readonly files: readonly string[]; // paths relative to the bundle it provides ("lib/libass.so.9"); [] for a static or header-only component
    readonly source: { readonly kind: "upstream"; readonly url: string; readonly sha256: string }
                   | { readonly kind: "srpm"; readonly srpm: string };  // "libass-0.17.3-2.fc44.src.rpm"
  }
  export const Components: z.ZodType<readonly Component[]>;
  /** One line per problem: a bundle file no component provides, a component with no license file, a licenses/ dir no component names. Empty when the bundle is complete. */
  export const licenseGaps = (bundleDir: string): string[];
  ```
  Task 3's `package:check` and Task 5's source task use these.

Each source-built component (mpv, libplacebo, ffmpeg, sdl2, nv-codec-headers, curl, shaderc, glslang, spirv-tools, spirv-headers) takes its license files from its tarball. The recipe names them per component in `build.sh`, for example `ffmpeg: LICENSE.md COPYING.GPLv2 COPYING.GPLv3 COPYING.LGPLv2.1 COPYING.LGPLv3`. Each library copied from an RPM becomes the component `%{NAME}` of the package that owns it (`rpm -qf`), with `%{VERSION}-%{RELEASE}`, `%{LICENSE}` and `%{SOURCERPM}`, and `rpm -qL` gives its license files. A package that marks no `%license` file fails the build and names the package. The research flags this risk. The fix is that package's own license file, copied from its `/usr/share/doc` and named in `build.sh`, never a text we write.

- [ ] **Step 1: Write the failing unit tests for `licenseGaps`**

These go in `licenses.test.ts`, on temp dirs:

- complete bundle → `[]`
- `lib/libfoo.so.1` with no component → `["lib/libfoo.so.1: no component provides it"]`
- component `foo` whose `licenses/foo/` is missing or empty → `["foo: no license file in licenses/foo/"]`
- `licenses/bar/` that no component names → `["licenses/bar/: no component named bar"]`
- `licenses/README` or `licenses/COPYING.GPLv3` missing → `["licenses/README: missing"]` / `["licenses/COPYING.GPLv3: missing"]`

- [ ] **Step 2: Run them to fail, implement `licenses.ts`, run them to pass**

Run: `scripts/bounded.sh test 2G -- bun x vitest run --maxWorkers=2 packages/mpv/src/licenses.test.ts`

- [ ] **Step 3: Add the bundle tests**

These go in `bundle.test.ts`:

- `licenseGaps(bundleDir)` is `[]`.
- `components` names exactly the source-built ten plus the RPM packages. The test lists the names as a literal sorted array, written down from the first build.
- `ffmpeg`'s license is `GPL-2.0-or-later`, and `licenses/COPYING.GPLv3` starts with `GNU GENERAL PUBLIC LICENSE` and has `Version 3, 29 June 2007` on its second line.
- every `srpm` source ends in `.fc44.src.rpm`.

- [ ] **Step 4: Extend `build.sh`, rebuild, and run the bundle tests to pass**

Run: `mise run mpv:build && scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 packages/mpv`
Expected: PASS.

- [ ] **Step 5: Commit**

`build(mpv): ship each component's license, the source list and the build lines in the bundle`

---

### Task 3: The packaged app plays with `resources/mpv/mpv`, and the AppImage carries every license

**Files:**

- Modify: `mise.toml`. `package` gets `depends = ["mpv:build"]`. Its run stages `$(bun packages/mpv/src/bundle-dir.ts)` to `.cache/package/mpv/` (`rm -rf`, then `cp -a`) before the bounded electron-builder run. `package:check`'s description gains "and the bundled mpv".
- Modify: `apps/desktop/electron-builder.yml`. Add `extraResources` `from: ../../.cache/package/mpv`, `to: mpv`, and `extraFiles` `from: ../../LICENSE`, `to: LICENSE`.
- Modify: `apps/desktop/electron.vite.config.ts`. Set `build.license: { fileName: "licenses.md" }` on main, preload and renderer. Each output then lists the npm code it bundles.
- Modify: `apps/desktop/src/main/player/mpv-binary.ts` and `mpv-binary.test.ts`
- Modify: `scripts/check-release.ts`
- Create: `packages/mpv/src/release-check.ts`, `packages/mpv/src/release-check.test.ts`

**Interfaces:**

- Consumes: `licenseGaps`, `Components` (Task 2), and `readHostLibs` and `unbundledNeeds` (`packages/mpv/src/host-libs.ts`). Also `bundleDirIn`, `repoRootFrom` and `recipeHash` (`packages/mpv/src/bundle.ts`).
- Produces: `MpvBinarySources.resourcesPath: string`, which `mpvBinary()` fills from `process.resourcesPath`.

- [ ] **Step 1: Replace the PATH test with the packaged one**

```ts
it("a packaged app plays with the mpv it ships", () => {
  const bundled = vi.fn<() => string>(() => "/never");
  expect(
    resolveMpvBinary({
      override: undefined,
      packaged: true,
      resourcesPath: "/tmp/.mount_harakiXYZ/resources",
      bundled,
    })
  ).toBe("/tmp/.mount_harakiXYZ/resources/mpv/mpv");
  expect(bundled).not.toHaveBeenCalled();
});
```

The other two tests gain `resourcesPath`, with literal values unchanged.

- [ ] **Step 2: Run to fail, then change `resolveMpvBinary`, and run to pass**

Run: `scripts/bounded.sh test 2G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/player/mpv-binary.test.ts`

- [ ] **Step 3: Add the checks on the AppImage's `resources/mpv/` to `check-release.ts`**

Each check prints `ok:` or `FAIL:` like the others:

- **"mpv is this recipe's build":** every file of `.cache/mpv/<current hash>/` has the same sha256 under `resources/mpv/`, and `resources/mpv/` has no other files. This is Review Focus 5. In the failure, name the first file that differs.
- **"mpv runs":** `env -i <resources>/mpv/mpv --no-config --version` exits 0 and prints the `mpv 0.42.0` line that `bundle.test.ts` asserts. `-v` names `-Dsdl2-gamepad=enabled`.
- **"mpv decoders":** `--vd=help` lists `hevc`, `h264`, `vc1` and `av1`, and `--ad=help` lists `truehd`, `eac3` and `dca`. `--list-options` lists `--input-gamepad`.
- **"mpv host libs":** `unbundledNeeds(<resources>/mpv, readHostLibs("mpv"))` is `[]`.
- **"licenses":**
  - `licenseGaps(<resources>/mpv)` is `[]`.
  - The AppImage root has `LICENSE` (harakiri's, byte-equal to the repo's), `LICENSE.electron.txt` and `LICENSES.chromium.html`.
  - `app.asar` holds `out/renderer/licenses.md`, `out/main/licenses.md` and `out/preload/licenses.md`, and the renderer's names `react`.

- [ ] **Step 4: Prove the bundle checks fail on a tampered bundle**

The mpv checks live in `packages/mpv/src/release-check.ts` (vitest covers only `packages/*` and `apps/desktop`) as `mpvBundleProblems(shipped: string, built: string): string[]`, and `check-release.ts` prints them. `packages/mpv/src/release-check.test.ts` copies the real bundle to a temp dir twice. On the first copy it asserts `[]`. From the second it deletes `licenses/harfbuzz/` and `lib/libass.so.9`, and asserts that the result contains `"harfbuzz: no license file in licenses/harfbuzz/"` and `"lib/libass.so.9: differs from the recipe's build"`. The test needs the bundle, so it fails naming `mise run mpv:build` without one, like `bundle.test.ts`.

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 packages/mpv/src/release-check.test.ts` (to fail, implement, pass). Then `mise run package && mise run package:check`. Expected: every line `ok:`.

- [ ] **Step 5: Commit**

`feat(release): ship harakiri's mpv in the AppImage, with every license`

---

### Task 4: mpv loads its own libraries whatever `LD_LIBRARY_PATH` says

**Files:**

- Modify: `packages/mpv/src/client.ts`. `MpvSpawnOptions.env?: Readonly<Record<string, string>>` is passed to `spawn`. When it is unset, mpv inherits as today.
- Modify: `packages/mpv/src/client.test.ts`
- Modify: `apps/desktop/src/main/host/` (a new `child-env.ts`, exported from `index.ts`). The host is the only code that reads `process.env` (`lint-host`).
- Modify: `apps/desktop/src/main/player/create-player.ts`, `playback.ts`, `index.ts`. `PlaybackDeps.mpvEnv` is resolved per play next to `mpvBinary`, and `spawnMpv({ …, env: deps.mpvEnv })`.

**Interfaces:**

- Produces: `export const bundledMpvEnv = (env: Readonly<Record<string, string | undefined>>): Record<string, string>`, which returns `env` without `LD_LIBRARY_PATH`, `LD_PRELOAD` or undefined values. `PlayerWiring.mpvEnv: () => Readonly<Record<string, string>>` is `process.env` as it is when `HARAKIRI_MPV` is set, and `bundledMpvEnv(process.env)` otherwise.

- [ ] **Step 1: Write the failing tests**

`client.test.ts`, using the real bundle:

```ts
it("runs mpv with the env it is given, so a decoy library path cannot replace the bundle's own", async () => {
  // decoy/libavcodec.so.63 is a 4-byte file: the loader fails on it if it is ever searched
  const decoy = await decoyLibDir(["libavcodec.so.63"]);
  await expect(
    spawnMpv({ config: NO_CONFIG, binary: bundledMpv(), env: { LD_LIBRARY_PATH: decoy } })
  ).rejects.toThrow(/libavcodec\.so\.63/u); // the control: the decoy really is searched
  const mpv = await spawnMpv({
    config: NO_CONFIG,
    binary: bundledMpv(),
    env: bundledMpvEnv({ LD_LIBRARY_PATH: decoy }),
  });
  expect(await mpv.getProperty("mpv-version")).toBe("mpv v0.42.0");
  await mpv.quit();
});
```

`bundledMpvEnv` lives in desktop, so this test builds the same scrubbed env inline: `{ PATH: process.env.PATH }`. The desktop test covers the function itself. Use the version string `bundle.test.ts` asserts.

In `host`'s test: `bundledMpvEnv({ LD_LIBRARY_PATH: "/x", LD_PRELOAD: "/y.so", HOME: "/h", WAYLAND_DISPLAY: "wayland-1" })` is `{ HOME: "/h", WAYLAND_DISPLAY: "wayland-1" }`.

In `create-player.test.ts`: a play with `mpvEnv: () => ({ HOME: "/h" })` spawns with exactly that env. With `HARAKIRI_MPV` set, the wiring passes the full env; this is a wiring unit test with a stub env.

- [ ] **Step 2: Run them to fail, implement, run them to pass**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 packages/mpv/src/client.test.ts apps/desktop/src/main/host apps/desktop/src/main/player/create-player.test.ts`

- [ ] **Step 3: Run the player's local tier and `lint:host`**

Run: `scripts/bounded.sh local 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/player/playback.local.test.ts && mise run lint:host`. Expected: PASS. Secrets are still absent from the real cmdline.

- [ ] **Step 4: Commit**

`fix(player): start mpv without the library path a launcher or Steam set`

---

### Task 5: The release job builds the bundle and publishes its source

**Files:**

- Modify: `mise.toml`. New task `mpv:source`: `.cache/mpv/<hash>/manifest.json` → `apps/desktop/dist/harakiri-mpv-source.tar` and an updated `apps/desktop/dist/SHA256SUMS`.
- Create: `mpv/source.sh`, which `mpv:source` runs. It is part of the recipe, so it changes the hash.
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`. Install becomes one AppImage and nothing else. The badge goes from mpv 0.41 to 0.42. A "License" section: harakiri is MIT; the AppImage also carries mpv, FFmpeg and their libraries under GPLv3, in `resources/mpv/licenses/`, with source on each release.
- Modify: `docs/PRD.md`. Distribution: the bundled mpv. Drop "a bundled mpv (#2)" from what is not shipped.
- Modify: `CLAUDE.md`, Releases: what the job uploads, and the dry run.

**Interfaces:**

- Consumes: `Components` (Task 2), `mpv/fetch.sh`, and `BASE_IMAGE` from `versions.env`.
- Produces: the release assets `harakiri-x86_64.AppImage`, `latest-linux.yml`, `harakiri-mpv-source.tar` and `SHA256SUMS`.

`harakiri-mpv-source.tar` holds:

```text
harakiri-mpv-source/
├── README                 how to rebuild: mise run mpv:build from the recipe below
├── recipe/                mpv/ at this tag (the scripts that control compilation, GPLv3 §1)
├── upstream/              each `upstream` component's tarball, from .cache/mpv/src, sha256 as pinned
├── srpms/                 each `srpm` component's source RPM: dnf download --source in BASE_IMAGE,
│                          --disablerepo='*' --enablerepo=fedora-source (the frozen release repo, so the
│                          exact versions the build installed)
├── SOURCES.txt
└── BUILDING.txt
```

The asset name has no version: the same release always has one, like the AppImage.

- [ ] **Step 1: `mpv/source.sh` and `mpv:source`; build the tarball locally**

Run: `mise run mpv:source`. Expected: the tar lists `recipe/versions.env`. It has one `upstream/` file per `upstream` component and one `srpms/*.fc44.src.rpm` per `srpm` component, and `sha256sum -c` passes on the extracted `upstream/` files against `versions.env`. `mpv/source.sh` checks this itself before it exits, and fails naming the missing file or the wrong sha256. It is not a vitest test: no tier builds the tar, and `check` must not need it. It runs on every release.

- [ ] **Step 2: Change `release.yml`'s `package` job**

Steps, in order:

1. Read the recipe hash: `bun packages/mpv/src/bundle-dir.ts`.
2. `actions/cache@v4` on `.cache/mpv/<hash>` and `.cache/mpv/src`, keyed `mpv-<hash>`.
3. `mise run mpv:build` (podman is on `ubuntu-24.04`; a cache hit makes it a no-op).
4. `mise run package`, then `mise run package:check "${TAG#v}"`.
5. `mise run mpv:source`.
6. Upload all four assets with `--clobber`.
7. Append one line to the release notes unless it is already there: "The bundled mpv is GPLv3; its corresponding source is `harakiri-mpv-source.tar` on this release." Use `gh release view --json body` and `gh release edit --notes-file`.

`workflow_dispatch` gains `dry-run` (boolean, default false). On a dry run the job checks out the dispatched ref, not `TAG`. It skips steps 6 and 7 and uploads the four files as a workflow artifact. On a dry run the tag check and `package:check`'s version argument use `package.json`'s version.

- [ ] **Step 3: Prove it in CI with a dry run**

Push the branch. Run: `gh workflow run release.yml --ref <branch> -f tag=v0.0.0 -f dry-run=true`, then `gh run watch`. Expected:

- The job passes.
- The artifact holds the four files.
- A second dispatch restores the bundle from the cache and finishes without building mpv.

Pushing the branch and dispatching both happen only once the owner says go.

- [ ] **Step 4: Docs, then commit**

`ci(release): build harakiri's mpv in the release job and publish its corresponding source`

---

### Task 6: `package:check-hosts` runs the shipped bundle on the Bazzite and Arch images

**Files:**

- Create: `scripts/check-hosts.sh`
- Modify: `mise.toml`, a new task `package:check-hosts`, opt-in. It is not in `check` or CI: the Bazzite image is several GB.
- Modify: `CLAUDE.md`, Releases: run it before the first release that ships the bundle, and after a recipe change.

For each of `ghcr.io/ublue-os/bazzite:stable` and `docker.io/library/archlinux:latest`, the script mounts the AppImage's extracted `resources/mpv` read-only. It runs `podman run --rm --memory 1g --network none`, and fails naming the image when:

- `ldd <bundle>/mpv` or any `lib/*.so*` prints `not found`, or prints `version ... not found` (Review Focus 2);
- `<bundle>/mpv --no-config --version` fails;
- `<bundle>/mpv --no-config --msg-level=curl=trace https://127.0.0.1:9/` does not log `OpenSSL default paths (fallback)`, or does log `error setting certificate`. That proves the image's OpenSSL loaded its own trust store (Review Focus 3).
- the directory or file that `openssl version -d` names (`certs/` or `cert.pem`) is empty. That proves the store has certificates.

Images are taken by tag on purpose: the check is about the hosts users run today.

- [ ] **Step 1: Write the script and run it**

Run: `mise run package && scripts/bounded.sh hosts 3G -- mise run package:check-hosts`. Expected: `ok: <image>` for both.

- [ ] **Step 2: Show that it fails**

Run it with `HOST_IMAGES=docker.io/library/ubuntu:24.04`, the override the script reads. Expected: FAIL naming `GLIBC_2.4x not found`, which is decision 5's floor. Record the output in the report.

- [ ] **Step 3: Commit**

`test(release): check the shipped mpv on the Bazzite and Arch images`

---

## Phase validation

### Automated

- [ ] `mise run check`
- [ ] `mise run test:platform`
- [ ] `mise run e2e`. The guest and host specs run on the new bundle hash.
- [ ] `mise run package && mise run package:check && mise run package:check-hosts`
- [ ] The release dry run (Task 5, Step 3)

### Manual (the owner, on the HTPC)

- [ ] Remove the distrobox wrapper from `PATH`. Update through the updater once a release carries this phase. From Game Mode, play an HDR film with TrueHD. The run log shows `…/resources/mpv/mpv` and mpv 0.42.0, the AVR shows TrueHD, and the held d-pad skip works.
