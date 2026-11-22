---
task: 2026-11-20-bazzite-plug-and-play
type: plan
repo: harakiri
branch: tcorzo/bazzite-first-party
sha: 25991bc3f6ab1d9b9d8bb522914071a50ef71715
---

**Repos touched:** `harakiri`

# Bazzite plug and play, part 4: harakiri adds itself to Steam (#10, #20) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a machine with Steam, harakiri offers "Add to Steam". It writes a launcher script that clears `LD_PRELOAD` and execs the AppImage, hands Steam a hidden `.desktop` through `steam://addnonsteamgame`, reads the new shortcut's app ID back from `shortcuts.vdf`, and writes its artwork into `grid/`.

**Architecture:** Everything that knows Steam lives under `apps/desktop/src/main/host/` (new `host/steam/`), so `scripts/lint-host.ts` needs no new exemption. The host exports behaviour-named functions (`launcherState`, `addToLauncher`, `healLauncher`) and the launcher's display name. `main/launcher.ts` wires them to Electron and the e2e substitutions. The renderer shows a card on the library and a Settings row, with copy built from the name the host sends, so no renderer file names a platform. The artwork is rendered from the README's vectors by `apps/desktop/build/steam/render.ts` with the system ffmpeg's librsvg decoder, committed, and shipped through `extraResources`.

**Tech Stack:** Electron 45.1.0 (`shell.openExternal`), TypeScript 7, vitest 5 (`--maxWorkers=2`), React 19 + TanStack Query, Playwright e2e under nested KWin, system ffmpeg 8.1.3 (RPM Fusion, `--enable-librsvg`), electron-builder 26.18.0.

**Spec:** `docs/tasks/2026-11-20-bazzite-plug-and-play/03-structure-outline-bazzite-plug-and-play.md` (Phase 10, and the resolved "Steam artwork sizes" question), `02-design-discussion-bazzite-plug-and-play.md` (Q13). The outline wins where they differ. This plan extends contract C1 of `05-contracts-and-waves.md`.

**Not in this plan:** the HTPC checklist script (Phase 11). The `*.platform.test.ts` tier, `mise run test:platform` and `dev/vm/guest.sh` come from Phase 4. Task 9 needs Phase 4 merged; Tasks 1 to 8 do not.

## Decisions this plan makes beyond the outline

- **The Steam module is `host/steam/`, not `main/steam-setup/`.** `lint-host` flags `\bsteam` in any feature file, and that includes an import specifier such as `"./steam-setup/add"`. Under `host/` the module is exempt by the existing rule. `ipc.ts` and `index.ts` import only behaviour-named exports from `./host/index`.
- **The renderer never spells "Steam".** `launcher:status` carries `name: "Steam"` from the host, and the copy is built from it. The renderer asks "is there a launcher to add harakiri to, and what is it called". This is the capability pattern, and it keeps `lint-host` clean without exempting renderer files.
- **`steamLibrary` is not a memoized field of `HostCapabilities`.** The user adds the shortcut while harakiri runs, so the answer changes. `capabilities.ts` gains the type and the pure `steamLibraryOf(steam, script)`. `facts.ts` gains `readSteamFacts(env)`, which reads the disk again on each call. `HostCapabilities` and its memo are unchanged.
- **The app ID is read back, never computed.** The entry whose `Exe`, with one pair of surrounding double quotes removed, equals the script path is ours. Keys match case-insensitively, because Steam writes `AppName`/`Exe` for shortcuts it adds itself, and tools write `appname`/`exe` (Steam ROM Manager `src/lib/vdf-shortcuts-file.ts`). `appid` is a little-endian int32 that Steam treats as signed. The grid name uses the unsigned value (`readUInt32LE`, which equals `appid + 2^32` for a negative one, as in Steam ROM Manager's `appifyShortcutId`/`shortenAppId`).
- **Grid names:** portrait `<appId>p.png`, wide `<appId>.png`, hero `<appId>_hero.png`, logo `<appId>_logo.png`. No `<appId>_icon.png`: Steam shows a shortcut's icon from the `icon` field in `shortcuts.vdf`, which harakiri does not write. The icon goes in the `.desktop` file's `Icon=` instead. Whether Steam's URL handler copies it is unverified (manual check).
- **Five rendered images, not four:** portrait, wide, hero and logo for `grid/`, plus a 256×256 `icon.png` for `Icon=`.
- **Several Steam users:** every `userdata/<id>/` whose `shortcuts.vdf` holds our entry gets the artwork, under its own app ID. A user without the entry gets nothing. The state is `"added"` when any user has the entry.
- **Artwork never overwrites.** A file already in `grid/` stays (`COPYFILE_EXCL`), because Steam's "Set custom artwork" writes the same names.
- **Steam not running:** harakiri does not check. `openExternal` hands the URL to the desktop's `steam://` handler, which starts Steam. If Steam lists the shortcut within 30 s, the add succeeds. Otherwise the result is `timedOut`. The sentinel is removed when the poll ends, if harakiri created it, so it does not keep the URL handler open to local paths after the add.
- **Timeout:** the launcher and `.desktop` stay. If Steam lists the shortcut later, the heal at the next start writes the artwork. The UI says to open Steam and try again.
- **Not from an AppImage (dev, unpackaged):** there is no target to exec, so the state is `"unavailable"`. The card and the Settings row do not show, and the heal does nothing. e2e sets `HARAKIRI_E2E_LAUNCH_TARGET`, which is honoured only with `HARAKIRI_E2E=1`, like `HARAKIRI_MPV_ARGS`.
- **The heal at startup:** after ready, not awaited, never rejects. If an AppImage target exists and either the script exists or some user's shortcut points at it, the launcher, `.desktop` and icon are rewritten when their text differs. Then every user whose shortcut points at the script gets any missing artwork.
- **Flatpak Steam is not looked for.** Its sandbox does not see harakiri's `userData`. The roots are `~/.local/share/Steam` and `~/.steam/steam`, as the outline says.
- **One add at a time:** a second `launcher:add` while one runs returns the same promise.
- **e2e gets an empty `HOME` by default**, so no spec sees the developer's own Steam. `steam.spec.ts` builds a Steam root inside it.
- **The rasteriser is the system ffmpeg's `librsvg` decoder, with no new dependency.** RPM Fusion's ffmpeg 8.1.3 is built with `--enable-librsvg`, and the default tier already runs real ffmpeg. Two renders on one machine are byte-identical. Another librsvg version may differ by a little anti-aliasing, so the test compares decoded RGBA within ±2 per channel, not PNG bytes. `doctor` gains a librsvg check. Playwright's Chromium was not chosen: nothing in `setup` installs Playwright browsers, and e2e drives Electron. ImageMagick is not a declared dependency.

## Primary sources

- Steamworks, Library Assets (`partner.steamgames.com/doc/store/assets/libraryassets`). Capsule 600×900. Header 920×430. Hero 3840×1240, no text, with a centred 860×380 safe area. Logo is a transparent PNG, "either 1280px wide and/or 720px tall".
- Steam ROM Manager `src/lib/artwork-types/available-artwork-types.ts` at `979a88d`: `tall: "p"`, `long: ""`, `hero: "_hero"`, `logo: "_logo"`, `icon: "_icon"`. Valve does not document the grid names.
- Steam ROM Manager `src/lib/helpers/steam/generate-app-id.ts`: the vdf `appid` is signed, and the grid ID is the unsigned value.
- `steam-shortcut-editor` `lib/constants.js` and `lib/parser.js` at `d755f03` (the parser Steam ROM Manager uses). Type bytes are `0x00` object, `0x01` string, `0x02` int32 LE, and `0x08` object end. Names and strings are NUL-terminated UTF-8.
- Bazzite `spec_files/steamdeck-gnome-presets/steamos-add-to-steam` at `dfa558b`, and Heroic `src/backend/shortcuts/nonesteamgame/steamUrlHandler.ts` at `a508a95`. Both touch `/tmp/addnonsteamgamefile`, then run `steam steam://addnonsteamgame/<percent-encoded absolute path>`. Heroic notes that the handler accepts local paths only while the sentinel exists, and its `.desktop` carries `Name`, `Exec`, `Path`, `Icon`, `Terminal=false` and `NoDisplay=true`.
- electron-builder 26.18.0 `contents.md`: `extraResources` `from` is relative to the project dir, and `to` is relative to `resources/`.

**Unverified, checked on the HTPC:** whether Steam stores `Exe` quoted for a `.desktop` add (the matcher accepts both forms), whether it reads `Icon=`, whether it shows grid art written while it runs, and whether it deletes the sentinel itself.

## Global Constraints

- Run tests through the bounded runner: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 <paths>`. e2e runs only as `mise run e2e`.
- Commits are Conventional Commits and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only the task's files.
- Tests never skip. Nothing committed holds home-directory paths, owner domains or library titles. Test paths use `/opt/…`, `/data/…` or a `mkdtemp` dir.
- Inside `lint-host`'s scope (`apps/desktop/src`, `packages/*/src`, tests and `fixtures/` exempt), only files under `apps/desktop/src/main/host/` may contain `steam`, `LD_PRELOAD`, `gamescope` or `kwin`, in code, comments or import paths. `main/launcher.ts`, `env.ts`, `ipc.ts`, `index.ts`, `shared/bridge.ts`, `preload/` and the renderer say "launcher". `build/steam/` and `e2e/` are outside the scope.
- zod only at IO edges: the bridge schemas and ffprobe JSON. Use ts-pattern `.exhaustive()` on new unions.
- Web UI goes through the impeccable loop: load the `impeccable` skill, run `context --target apps/desktop`, read its craft floor before each UI edit, run its detector on what changed, then critique and audit. React follows `vercel-react-best-practices`: `client-localstorage-schema`, `rerender-lazy-state-init`, `rerender-derived-state-no-effect` and `rerender-move-effect-to-event`.
- Exact values: the sentinel is `/tmp/addnonsteamgamefile`, the URL is `steam://addnonsteamgame/${encodeURIComponent(desktopPath)}`, the poll is every 500 ms for 30 000 ms, and the launcher dir is `<userData>/steam/` with `harakiri.sh`, `harakiri.desktop` and `icon.png`.
- Exact copy, where `{name}` is the launcher name (`Steam`):
  - card title `Play harakiri from {name}`
  - card body `Adds harakiri to your {name} library, with its art. Launch it from there in Game Mode.`
  - card actions `Add to {name}` and `Not now`; while adding, `Adding to {name}…`
  - timed out: `{name} did not list harakiri in time. Open {name}, then try again.`
  - failed: `Could not add harakiri to {name}: {reason}`
  - Settings action `Add to {name}`, with detail `Adds harakiri to your {name} library, with its art`
  - Settings row once added: term `{name}`, value `harakiri is in your library`
  - no AppImage: reason `harakiri is not running from its AppImage`

## Review Focus

1. **`shortcuts.vdf` caught mid-write, empty, or holding a type byte the parser does not know.** Expected: that read counts as no shortcuts, one warning is logged, and the poll keeps going. Pinned in Tasks 2 and 5.
2. **The owner presses Add twice, or presses it in the card and then in Settings.** Expected: one launcher write, one URL, one shortcut. Pinned in Task 6.
3. **The owner already set custom art for the shortcut in Steam.** Expected: the heal and a re-add keep it. Pinned in Task 4.
4. **The AppImage path, or `userData`, holds a space or a single quote** (`/opt/my apps/harakiri's/harakiri-x86_64.AppImage`). Expected: the script still execs it, and `Exec=` is quoted per the Desktop Entry spec. Pinned in Task 4.
5. **Two Steam users, with the shortcut only in the second, and `~/.steam/steam` a symlink to `~/.local/share/Steam`.** Expected: one root, two users, and art only in the second user's `grid/`. Pinned in Tasks 3 and 5.

---

### Task 1: Steam artwork, rendered from the README's vectors and packed in the AppImage

**Files:**

- Create: `apps/desktop/build/steam/render.ts`, `apps/desktop/build/steam/render.test.ts`
- Create (generated, committed): `apps/desktop/build/steam/{portrait,wide,hero,logo,icon}.png`
- Modify: `apps/desktop/tsconfig.node.json` (`include` gains `"build/steam"`), `apps/desktop/vitest.config.ts` (`include` gains `"build/**/*.test.ts"`)
- Modify: `apps/desktop/electron-builder.yml`, `scripts/check-release.ts`, `mise.toml`
- Modify: `packages/harness/src/doctor.ts` (one check) and its test if one lists `CHECKS`

**Interfaces:**

- Produces:

```ts
// build/steam/render.ts
export interface ArtworkSpec {
  readonly file: "portrait.png" | "wide.png" | "hero.png" | "logo.png" | "icon.png";
  readonly width: number;
  readonly height: number;
  readonly alpha: boolean; // rgba when true, rgb24 otherwise
}
export const ARTWORK: readonly ArtworkSpec[];
export const renderArtwork: (outDir: string) => Promise<void>; // runs ffmpeg once per image
// CLI: `bun apps/desktop/build/steam/render.ts` renders into its own directory
```

- Task 4 copies `portrait.png`, `wide.png`, `hero.png` and `logo.png` into `grid/`, and `icon.png` next to the launcher.

The sizes are fixed. The positions below are the starting layout, and the impeccable critique in Step 5 may move them. Inputs: `docs/assets/readme/icon.svg` (1024×1024), `docs/assets/readme/logo-dark.svg` (404.75×97.5). Background `#0a0605`.

| file           | size      | pix_fmt | layout                                                                      |
| -------------- | --------- | ------- | --------------------------------------------------------------------------- |
| `portrait.png` | 600×900   | rgb24   | icon 360×360 at x centred, y 250; wordmark 480 wide at x centred, y 660     |
| `wide.png`     | 920×430   | rgb24   | icon 240×240 at x 110, y centred; wordmark 440 wide at x 400, y centred     |
| `hero.png`     | 3840×1240 | rgb24   | icon 1000×1000 centred; no wordmark (Valve: no text; Steam layers the logo) |
| `logo.png`     | 1280×308  | rgba    | wordmark 1280 wide on transparent, nothing else                             |
| `icon.png`     | 256×256   | rgba    | icon.svg at 256×256                                                         |

The command shape, verified on ffmpeg 8.1.3 (portrait):

```sh
ffmpeg -v error -y -f lavfi -i color=c=0x0a0605:s=600x900 \
  -width 360 -height 360 -i docs/assets/readme/icon.svg \
  -width 480 -i docs/assets/readme/logo-dark.svg \
  -filter_complex "[0][1]overlay=(W-w)/2:250[a];[a][2]overlay=(W-w)/2:660,format=rgb24" \
  -frames:v 1 portrait.png
```

`logo.png` and `icon.png` decode the SVG alone with `-vf format=rgba`. Spawn with `execFile`, never a shell. Paths resolve from `import.meta.dirname`.

- [ ] **Step 1: Write the failing test**

`render.test.ts`, using a `decode(file)` helper. The helper parses `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,pix_fmt -of json` with zod, and reads `ffmpeg -v error -i <file> -f rawvideo -pix_fmt rgba -` as a Buffer.

```ts
describe("the committed Steam artwork", () => {
  it.each(ARTWORK)("$file is $width×$height", async ({ file, width, height, alpha }) => {
    const { probe } = await decode(path.join(here, file));
    expect(probe).toStrictEqual({ width, height, pix_fmt: alpha ? "rgba" : "rgb24" });
  });

  it("is what render.ts draws today, within ±2 per channel", async () => {
    const fresh = mkdtempSync(path.join(tmpdir(), "harakiri-art-"));
    await renderArtwork(fresh);
    for (const { file } of ARTWORK) {
      const [committed, now] = await Promise.all([
        decode(path.join(here, file)),
        decode(path.join(fresh, file)),
      ]);
      expect(now.rgba.length).toBe(committed.rgba.length);
      expect(maxChannelDelta(committed.rgba, now.rgba), file).toBeLessThanOrEqual(2);
    }
  });

  it("the logo is see-through around the wordmark", async () => {
    const { rgba } = await decode(path.join(here, "logo.png"));
    expect(rgba[3]).toBe(0); // top-left pixel alpha
  });
});
```

The failure message names `mise run steam:art`, as `table.test.ts` names `fidelity:table`.

- [ ] **Step 2: Run it to see it fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/build/steam`
Expected: FAIL (no `render.ts`).

- [ ] **Step 3: Implement `render.ts`, add the task, and render**

- Add `mise.toml` `[tasks."steam:art"]`. Its description is "Render the Steam library artwork in apps/desktop/build/steam from the README's icon and wordmark", and it runs `bun apps/desktop/build/steam/render.ts`.
- Run `mise run steam:art`.

- [ ] **Step 4: Run the test to see it pass**

Same command. Expected: PASS.

- [ ] **Step 5: Critique the artwork (impeccable)**

Load `impeccable` and run `context --target apps/desktop`. Critique the five PNGs against `apps/desktop/PRODUCT.md` and `.impeccable/surfaces/src-renderer.md`. The hero layout is the one open design call. Keep the icon inside the centred 860×380 safe area, or say why not. Any change goes into `render.ts`, followed by `mise run steam:art` and Step 4 again.

- [ ] **Step 6: Pack and check the images, and teach `doctor` about librsvg**

- `electron-builder.yml`:

```yaml
# Steam library artwork, copied into grid/ when harakiri adds itself to Steam.
extraResources:
  - from: build/steam
    to: steam
    filter: ["*.png"]
```

- `check-release.ts`: after extracting `resources/*`, add `check("Steam artwork packed", …)`. It fails naming each of the five files missing from `resources/steam/`.
- `doctor.ts`: add `{ label: "ffmpeg decoder librsvg", required: true, probe: ["ffmpeg", "-hide_banner", "-decoders"], judge: listsAll(["librsvg"], ffmpegRow) }` after "ffmpeg encoders".

- [ ] **Step 7: Verify**

Run: `mise run check && mise run doctor && mise run package && mise run package:check`
Expected: all pass. `package:check` prints "Steam artwork packed".

- [ ] **Step 8: Commit**

`feat(desktop): render Steam library artwork from the README's vectors`

---

### Task 2: A reader for Steam's binary `shortcuts.vdf`

**Files:**

- Create: `apps/desktop/src/main/host/steam/shortcuts-vdf.ts`
- Create: `apps/desktop/src/main/host/steam/fixtures/vdf.ts` (the encoder that tests and e2e use)
- Test: `apps/desktop/src/main/host/steam/shortcuts-vdf.test.ts`

**Interfaces:**

- Produces:

```ts
// shortcuts-vdf.ts
export interface Shortcut {
  readonly appId: number; // unsigned 32-bit, as grid/ names use it
  readonly appName: string;
  readonly exe: string; // as Steam stored it, quotes included
}
export class VdfError extends Error {}
/** Throws VdfError on a truncated buffer, an unknown type byte, or a root that is not "shortcuts". */
export const parseShortcuts: (bytes: Uint8Array) => Shortcut[];
/** ENOENT → []. VdfError → [] plus one warn naming the file. Other IO errors reject. */
export const readShortcuts: (file: string) => Promise<Shortcut[]>;
/** Strips one pair of surrounding double quotes. */
export const unquoteExe: (exe: string) => string;
export const shortcutFor: (shortcuts: readonly Shortcut[], script: string) => Shortcut | undefined;

// fixtures/vdf.ts
export interface ShortcutEntry {
  readonly appId: number; // written as appId >>> 0, so a negative int32 and its unsigned value encode alike
  readonly appName: string;
  readonly exe: string;
  readonly keys?: "steam" | "lower"; // "steam": appid/AppName/Exe (default); "lower": appid/appname/exe
}
export const encodeShortcuts: (entries: readonly ShortcutEntry[]) => Uint8Array;
```

- Wire format: `0x00 "shortcuts\0"`, then for each entry `0x00 "<index>\0"`, its fields, and `0x08`. Then `0x08 0x08`. A field is `<type> <name>\0 <value>`, where `0x01` is a NUL-terminated UTF-8 string, `0x02` is a 4-byte LE int, `0x00` is a nested object that ends at `0x08`, and `0x08` ends the object.
- `encodeShortcuts` writes every field Steam writes, so the parser meets real nesting: `appid`, `AppName`, `Exe`, `StartDir`, `icon`, `ShortcutPath`, `LaunchOptions`, `IsHidden` 0, `AllowDesktopConfig` 1, `AllowOverlay` 1, `OpenVR` 0, `Devkit` 0, `DevkitGameID` "", `DevkitOverrideAppID` 0, `LastPlayTime` 0, `FlatpakAppID` "", and `tags` `{ "0": "favorite" }`.
- `parseShortcuts` reads `appid` with `readUInt32LE`. It matches keys case-insensitively, and skips an entry that has no `appid` or no `exe`. A zero-length buffer gives `[]`.

- [ ] **Step 1: Write the failing tests**

```ts
it("reads Steam's casing and the unsigned app ID", () => {
  const bytes = encodeShortcuts([
    { appId: 3_141_592_653, appName: "harakiri", exe: '"/data/h/steam/harakiri.sh"' },
  ]);
  expect(parseShortcuts(bytes)).toStrictEqual([
    { appId: 3_141_592_653, appName: "harakiri", exe: '"/data/h/steam/harakiri.sh"' },
  ]);
});
it("a negative int32 app ID reads as its unsigned value", () => {
  expect(
    parseShortcuts(encodeShortcuts([{ appId: -1_153_374_643, appName: "a", exe: "/x" }]))[0]?.appId
  ).toBe(3_141_592_653);
});
it("reads lower-case keys written by other tools", () => {
  /* keys: "lower" → same Shortcut */
});
it("an empty file and a file with no entries have no shortcuts", () => {
  expect(parseShortcuts(new Uint8Array())).toStrictEqual([]);
  expect(parseShortcuts(encodeShortcuts([]))).toStrictEqual([]);
});
it.each([
  ["truncated mid-entry", (b: Uint8Array) => b.subarray(0, b.length - 20)],
  ["an unknown type byte", (b: Uint8Array) => withByte(b, firstFieldTypeOffset(b), 0x07)],
  ["a different root", () => encodeRoot("screenshots")],
])("%s throws VdfError", (_name, mangle) => {
  expect(() => parseShortcuts(mangle(encodeShortcuts([entry])))).toThrow(VdfError);
});
it("readShortcuts: a missing file is [], a broken one is [] and one warning", async () => {
  /* tmp dir, memory sink */
});
it.each([
  ['"/data/h/steam/harakiri.sh"', true],
  ["/data/h/steam/harakiri.sh", true],
  ['"/data/h/steam/harakiri.sh" --flag', false],
  ['"/data/other/harakiri.sh"', false],
])("shortcutFor matches Exe %s: %s", (exe, matches) => {
  /* … */
});
```

`withByte`, `firstFieldTypeOffset` and `encodeRoot` are small helpers in the test file.

- [ ] **Step 2: Run them to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/host/steam`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `shortcuts-vdf.ts` and `fixtures/vdf.ts`** with the signatures above. The parser is a cursor over a `Buffer`. Every read checks the bounds and throws `VdfError` instead of a `RangeError`.

- [ ] **Step 4: Run them to see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

`feat(desktop): read Steam's binary shortcuts file`

---

### Task 3: The host learns where Steam is and whether harakiri is in it

**Files:**

- Modify: `apps/desktop/src/main/host/facts.ts`, `apps/desktop/src/main/host/capabilities.ts`
- Create: `apps/desktop/src/main/host/fixtures/steam-root.ts`
- Test: `apps/desktop/src/main/host/host.test.ts`

**Interfaces:**

- Consumes: `Shortcut`, `readShortcuts`, `shortcutFor` (Task 2).
- Produces (extends C1; `HostFacts`, `HostCapabilities` and `createHost` are unchanged):

```ts
// facts.ts
export interface SteamUser {
  readonly id: string; // the userdata/<id> directory name, all digits
  readonly gridDir: string; // <root>/userdata/<id>/config/grid (may not exist yet)
  readonly shortcuts: readonly Shortcut[];
}
export interface SteamFacts {
  readonly root: string | undefined; // realpath of the first candidate with a userdata/ directory
  readonly users: readonly SteamUser[]; // sorted by numeric id
}
/** Candidates in order: $HOME/.local/share/Steam, then $HOME/.steam/steam. Unset or empty HOME → no root. */
export const steamRoots: (home: string) => readonly string[];
/** Reads the disk on every call: the user adds the shortcut while harakiri runs. Never rejects. */
export const readSteamFacts: (env: Readonly<Record<string, string | undefined>>) => Promise<SteamFacts>;

// capabilities.ts
export type SteamLibrary = "absent" | "present" | "has-harakiri";
/** absent: no root or no users. has-harakiri: some user has an entry shortcutFor(…, script). */
export const steamLibraryOf: (steam: SteamFacts, script: string) => SteamLibrary;

// fixtures/steam-root.ts
/** Builds <home>/.local/share/Steam/userdata/<id>/config/ for each user, with shortcuts.vdf when entries are given. */
export const fakeSteamRoot: (home: string, users: Readonly<Record<string, readonly ShortcutEntry[] | null>>) => string;
```

- A user is a `userdata/` entry whose name matches `/^\d+$/u` and that holds a `config/` directory. `readSteamFacts` catches IO errors other than ENOENT, logs one warning, and returns `{ root: undefined, users: [] }`.

- [ ] **Step 1: Write the failing tests** (each in a fresh `mkdtemp` home)

```ts
describe("Steam facts", () => {
  it("no HOME, or no Steam under it, is absent", async () => {
    expect(steamLibraryOf(await readSteamFacts({}), script)).toBe("absent");
    expect(steamLibraryOf(await readSteamFacts({ HOME: emptyHome }), script)).toBe("absent");
  });
  it("a root with a user and no shortcut is present", async () => {
    fakeSteamRoot(home, { "12345678": null });
    const steam = await readSteamFacts({ HOME: home });
    expect(steam.users.map((u) => u.id)).toStrictEqual(["12345678"]);
    expect(steamLibraryOf(steam, script)).toBe("present");
  });
  it("a user whose shortcut runs our script makes it has-harakiri", async () => {
    /* Exe: `"${script}"` */
  });
  it("~/.steam/steam linked to ~/.local/share/Steam is one root, users not doubled", async () => {
    /* symlinkSync */
  });
  it("only ~/.steam/steam is enough", async () => {
    /* … */
  });
  it("userdata/ entries that are not digits, or have no config/, are not users", async () => {
    /* "anonymous", "0" without config */
  });
  it("two users, the shortcut only in the second", async () => {
    fakeSteamRoot(home, {
      "111": [],
      "222": [{ appId: 7, appName: "harakiri", exe: `"${script}"` }],
    });
    const steam = await readSteamFacts({ HOME: home });
    expect(steam.users.map((u) => [u.id, u.shortcuts.length])).toStrictEqual([
      ["111", 0],
      ["222", 1],
    ]);
    expect(steamLibraryOf(steam, script)).toBe("has-harakiri");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/host`
Expected: FAIL (`readSteamFacts` not exported).

- [ ] **Step 3: Implement** the signatures above in `facts.ts` and `capabilities.ts`. Update `facts.ts`'s module comment: it also reads where Steam keeps its user data.

- [ ] **Step 4: Run them to see them pass, then run `mise run typecheck`**

Expected: PASS.

- [ ] **Step 5: Commit**

`feat(desktop): the host finds Steam's user data and harakiri's shortcut`

---

### Task 4: The launcher script, the hidden `.desktop`, and the artwork copy

**Files:**

- Create: `apps/desktop/src/main/host/steam/launcher.ts`, `apps/desktop/src/main/host/steam/artwork.ts`
- Test: `apps/desktop/src/main/host/steam/launcher.test.ts`, `apps/desktop/src/main/host/steam/artwork.test.ts`

**Interfaces:**

- Produces:

```ts
// launcher.ts
export interface LauncherFiles {
  readonly dir: string; // <userData>/steam
  readonly script: string; // <dir>/harakiri.sh
  readonly desktop: string; // <dir>/harakiri.desktop
  readonly icon: string; // <dir>/icon.png
}
export const launcherFiles: (userData: string) => LauncherFiles;
export const launcherScript: (target: string) => string;
export const desktopEntry: (files: LauncherFiles) => string; // throws on a path with a newline
/**
 * Writes the script (0755), the .desktop (0644) and the icon (copied from <artwork>/icon.png), each
 * atomically (temp file, then rename) and only when its bytes differ. Returns whether any changed.
 */
export const writeLauncher: (files: LauncherFiles, target: string, artwork: string) => Promise<boolean>;

// artwork.ts
export type GridKind = "portrait" | "wide" | "hero" | "logo";
export const ARTWORK_SOURCES: Readonly<Record<GridKind, string>>; // portrait.png, wide.png, hero.png, logo.png
export const gridNames: (appId: number) => Readonly<Record<GridKind, string>>; // throws unless 0 ≤ appId < 2^32, integer
/** mkdir -p gridDir; copies each absent name with COPYFILE_EXCL; returns the names written, in GridKind order. */
export const writeArtwork: (artwork: string, gridDir: string, appId: number) => Promise<readonly string[]>;
/** Where the PNGs are: <resourcesPath>/steam when packaged, else apps/desktop/build/steam. */
export const artworkDir: (where: { readonly packaged: boolean; readonly resourcesPath: string; readonly mainDir: string }) => string;
```

The exact text, with single quotes escaped as `'\''`:

```sh
#!/bin/sh
# Written by harakiri's "Add to Steam"; harakiri rewrites it at each start.
# Steam's overlay preload crashes Chromium's GPU process (harakiri #10), so it goes before harakiri starts.
unset LD_PRELOAD
exec '<target>' "$@"
```

```ini
[Desktop Entry]
Type=Application
Name=harakiri
Comment=TV-first Jellyfin player
Exec=<script, as an Exec argument>
Path=<dir>
Icon=<icon>
Terminal=false
NoDisplay=true
```

- An Exec argument stays bare when it matches `/^[\w./+,=@%-]+$/u`. Otherwise it is quoted per the Desktop Entry spec: wrap it in `"…"` with `` ` ``, `"`, `$` and `\` backslash-escaped, then apply the string-value escape (`\` → `\\`). `Path=` and `Icon=` take only the string-value escape.
- `artworkDir` returns `join(resourcesPath, "steam")` when packaged, else `join(mainDir, "../../build/steam")`. `mainDir` is the bundled main's `import.meta.dirname`, which is `out/main`.

- [ ] **Step 1: Write the failing tests**

```ts
it("the script clears the preload and execs the AppImage in place", () => {
  expect(launcherScript("/opt/harakiri/harakiri-x86_64.AppImage")).toBe(
    [
      "#!/bin/sh",
      `# Written by harakiri's "Add to Steam"; harakiri rewrites it at each start.`,
      "# Steam's overlay preload crashes Chromium's GPU process (harakiri #10), so it goes before harakiri starts.",
      "unset LD_PRELOAD",
      "exec '/opt/harakiri/harakiri-x86_64.AppImage' \"$@\"",
      "",
    ].join("\n")
  );
});
it("a quote and a space in the AppImage path survive a real sh", async () => {
  // write launcherScript("/opt/my apps/harakiri's/fake") where fake is a sh script printing "$0|$*";
  // run the launcher with args "a b" via execFile("/bin/sh", [script, "a b"]) → stdout "/opt/my apps/harakiri's/fake|a b"
});
it("the .desktop entry, bare paths", () => {
  expect(desktopEntry(launcherFiles("/data/harakiri"))).toBe(
    [
      "[Desktop Entry]",
      "Type=Application",
      "Name=harakiri",
      "Comment=TV-first Jellyfin player",
      "Exec=/data/harakiri/steam/harakiri.sh",
      "Path=/data/harakiri/steam",
      "Icon=/data/harakiri/steam/icon.png",
      "Terminal=false",
      "NoDisplay=true",
      "",
    ].join("\n")
  );
});
it("Exec quotes a path with a space", () => {
  expect(desktopEntry(launcherFiles("/data/my harakiri"))).toContain(
    'Exec="/data/my harakiri/steam/harakiri.sh"\n'
  );
});
it("writeLauncher writes 0755 and 0644, then reports no change on a second run", async () => {
  /* true, then false */
});
it("writeLauncher rewrites the script when the AppImage moved", async () => {
  /* new target → true, text has it */
});
```

The real-`sh` test uses a temp dir under `tmpdir()`. The `/opt/…` path is only the text under test.

```ts
it("grid names use the unsigned app ID", () => {
  expect(gridNames(3_141_592_653)).toStrictEqual({
    portrait: "3141592653p.png",
    wide: "3141592653.png",
    hero: "3141592653_hero.png",
    logo: "3141592653_logo.png",
  });
  expect(() => gridNames(-1)).toThrow();
});
it("writes the four images into a new grid/", async () => {
  /* returns all four names; bytes equal the sources */
});
it("never overwrites art already in grid/", async () => {
  // grid/3141592653_hero.png holds "custom" → writeArtwork returns the other three; the hero still reads "custom"
});
it("artworkDir", () => {
  expect(artworkDir({ packaged: true, resourcesPath: "/opt/h/resources", mainDir: "/x" })).toBe(
    "/opt/h/resources/steam"
  );
  expect(
    artworkDir({ packaged: false, resourcesPath: "", mainDir: "/r/apps/desktop/out/main" })
  ).toBe("/r/apps/desktop/build/steam");
});
```

The artwork tests copy from `apps/desktop/build/steam` (Task 1).

- [ ] **Step 2: Run them to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/host/steam`
Expected: FAIL.

- [ ] **Step 3: Implement `launcher.ts` and `artwork.ts`** with the signatures above.

- [ ] **Step 4: Run them to see them pass**

Expected: PASS.

- [ ] **Step 5: Commit**

`feat(desktop): write the launcher that clears Steam's overlay preload`

---

### Task 5: The add flow, the state, and the heal

**Files:**

- Create: `apps/desktop/src/main/host/steam/add.ts`
- Modify: `apps/desktop/src/main/host/index.ts` (behaviour-named exports)
- Test: `apps/desktop/src/main/host/steam/add.test.ts`

**Interfaces:**

- Consumes: Tasks 2 to 4.
- Produces:

```ts
// add.ts
export const STEAM_TMP = "/tmp"; // Steam looks for its sentinel here, whatever TMPDIR says
export const POLL_MS = 500;
export const TIMEOUT_MS = 30_000;
export interface LauncherPlace {
  readonly files: LauncherFiles;
  readonly target: string | undefined; // the AppImage; undefined when not running from one
  readonly artwork: string;
}
export type LauncherState = "unavailable" | "offered" | "added";
export type AddResult = { readonly state: "added" } | { readonly state: "timedOut" } | { readonly state: "failed"; readonly reason: string };
export interface AddDeps {
  readonly openExternal: (url: string) => Promise<void>;
  readonly readSteam: () => Promise<SteamFacts>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  readonly tmpDir: string;
}
export interface HealReport {
  readonly launcher: "no-target" | "absent" | "unchanged" | "rewritten";
  readonly artwork: readonly { readonly user: string; readonly written: readonly string[] }[];
}
/** unavailable: no target or steamLibraryOf is "absent"; added: "has-harakiri"; offered: "present". */
export const steamLauncherState: (steam: SteamFacts, place: LauncherPlace) => LauncherState;
export const addToSteam: (place: LauncherPlace, deps: AddDeps) => Promise<AddResult>;
export const healSteamLauncher: (place: LauncherPlace, steam: SteamFacts) => Promise<HealReport>; // never rejects

// host/index.ts: what feature code imports
export interface LauncherWhere { readonly userData: string; readonly target: string | undefined }
export const launcherName = "Steam";
export const launcherState: (where: LauncherWhere) => Promise<LauncherState>;
export const addToLauncher: (
  where: LauncherWhere,
  deps: { readonly openExternal: (url: string) => Promise<void>; readonly tmpDir?: string }
) => Promise<AddResult>;
export const healLauncher: (where: LauncherWhere) => Promise<HealReport>;
export type { AddResult, HealReport, LauncherState };
```

`host/index.ts` builds the `LauncherPlace` with `launcherFiles(where.userData)` and `artworkDir({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, mainDir: import.meta.dirname })`. It reads Steam with `readSteamFacts(process.env)`, and fills `sleep` from `node:timers/promises`, `now` from `Date.now`, and `tmpDir` from `deps.tmpDir ?? STEAM_TMP`.

`addToSteam`, in order:

```text
target undefined                → failed "harakiri is not running from its AppImage"
writeLauncher(files, target, artwork)
sentinel = join(tmpDir, "addnonsteamgamefile"); created = !exists(sentinel); write it empty
openExternal("steam://addnonsteamgame/" + encodeURIComponent(files.desktop))
  rejects                       → failed <error message>
start = now()
loop
  steam = readSteam()
  ours = users with shortcutFor(user.shortcuts, files.script)
  ours non-empty                → writeArtwork(artwork, user.gridDir, shortcut.appId) for each; added
  now() - start ≥ TIMEOUT_MS    → timedOut
  sleep(POLL_MS)
finally: remove the sentinel if created
```

A write error before the URL is opened becomes `failed` with the error's message, and the sentinel is cleaned up the same way. Log at info: "Asked the launcher to add {desktop}", "The launcher listed harakiri as {appId} for user {user}; wrote {written}", and "The launcher did not list harakiri within {ms} ms".

`healSteamLauncher`: with no target it returns `no-target`. When neither the script exists nor any user's shortcut points at it, it returns `absent`. Otherwise it runs `writeLauncher`, which gives `rewritten` or `unchanged`. Then every user with our shortcut gets `writeArtwork`. It catches and warns, and never rejects.

- [ ] **Step 1: Write the failing tests** (temp `userData`, a real `fakeSteamRoot`, a fake clock where `sleep(ms)` advances `now`)

```ts
it("adds: script, .desktop, sentinel present while the URL opens, art under the read-back ID, sentinel gone", async () => {
  const opened: { url: string; sentinel: boolean }[] = [];
  // openExternal records { url, sentinel: existsSync(join(tmp, "addnonsteamgamefile")) },
  // then writes user 222's shortcuts.vdf with { appId: 3_141_592_653, exe: `"${files.script}"` }
  await expect(addToSteam(place, deps)).resolves.toStrictEqual({ state: "added" });
  expect(opened).toStrictEqual([
    { url: `steam://addnonsteamgame/${encodeURIComponent(files.desktop)}`, sentinel: true },
  ]);
  expect(readdirSync(grid("222")).sort()).toStrictEqual([
    "3141592653.png",
    "3141592653_hero.png",
    "3141592653_logo.png",
    "3141592653p.png",
  ]);
  expect(existsSync(grid("111"))).toBe(false);
  expect(existsSync(join(tmp, "addnonsteamgamefile"))).toBe(false);
});
it("Steam lists it on the third poll", async () => {
  /* readSteam answers without, without, with → added; sleeps [500, 500] */
});
it("times out after 30 s and leaves the launcher for a later heal", async () => {
  // readSteam never lists it → { state: "timedOut" }; 60 sleeps of 500; script and .desktop still exist; sentinel gone
});
it("a sentinel that was already there stays", async () => {
  /* … */
});
it("a broken shortcuts.vdf mid-poll is skipped, not fatal", async () => {
  // first read: user 222's file is truncated bytes → no match; second read: valid → added
});
it("no AppImage fails with the reason and touches nothing", async () => {
  await expect(addToSteam({ ...place, target: undefined }, deps)).resolves.toStrictEqual({
    state: "failed",
    reason: "harakiri is not running from its AppImage",
  });
  expect(existsSync(files.dir)).toBe(false);
});
it("a URL the desktop cannot open fails with its message, sentinel removed", async () => {
  /* openExternal rejects */
});
it.each([
  ["no Steam", {}, "/opt/h.AppImage", "unavailable"],
  ["Steam, no AppImage", { "1": null }, undefined, "unavailable"],
  ["Steam", { "1": null }, "/opt/h.AppImage", "offered"],
  ["Steam with our shortcut", { "1": [ours] }, "/opt/h.AppImage", "added"],
])("state: %s", async (_name, users, target, state) => {
  /* steamLauncherState */
});
describe("the heal at startup", () => {
  it("rewrites a launcher whose AppImage moved", async () => {
    /* launcher: "rewritten"; script has the new path */
  });
  it("writes a launcher Steam points at even when userData lost it", async () => {
    /* … */
  });
  it("does nothing without a launcher or a shortcut", async () => {
    /* launcher: "absent"; no files */
  });
  it("does nothing without an AppImage", async () => {
    /* launcher: "no-target" */
  });
  it("adds art Steam listed after a timed-out add, and keeps custom art", async () => {
    /* … */
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/host`
Expected: FAIL.

- [ ] **Step 3: Implement `add.ts`, then the `host/index.ts` exports**

- [ ] **Step 4: Run them to see them pass, then run `mise run typecheck` and `bun scripts/lint-host.ts`**

Expected: PASS, and `lint-host` reports no hits.

- [ ] **Step 5: Commit**

`feat(desktop): add harakiri to Steam through its URL handler and read the shortcut back`

---

### Task 6: IPC, the bridge, and the heal at startup

**Files:**

- Create: `apps/desktop/src/main/launcher.ts`, `apps/desktop/src/main/launcher.test.ts`
- Modify: `apps/desktop/src/main/env.ts`, `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/shared/bridge.ts`, `apps/desktop/src/preload/bridge.ts`, `apps/desktop/src/preload/bridge.test.ts`
- Modify: `scripts/lint-host.ts` (the `EXEMPT` comment only)

**Interfaces:**

- Consumes: `launcherName`, `launcherState`, `addToLauncher`, `healLauncher`, `LauncherWhere` (Task 5); `ownAppImage` (`updates.ts`).
- Produces:

```ts
// shared/bridge.ts
channels.launcherStatus = "launcher:status";
channels.launcherAdd = "launcher:add";
export const LauncherStatus = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unavailable") }),
  z.object({ state: z.literal("offered"), name: z.string() }),
  z.object({ state: z.literal("added"), name: z.string() }),
]);
export const LauncherAddResult = z.discriminatedUnion("state", [
  z.object({ state: z.literal("added") }),
  z.object({ state: z.literal("timedOut") }),
  z.object({ state: z.literal("failed"), reason: z.string() }),
]);
export type LauncherStatus = z.infer<typeof LauncherStatus>;
export type LauncherAddResult = z.infer<typeof LauncherAddResult>;
HarakiriBridge.launcher: {
  readonly status: () => Promise<LauncherStatus>;
  /** Resolves when the launcher lists harakiri, after 30 s, or on failure. */
  readonly add: () => Promise<LauncherAddResult>;
};

// env.ts
HARAKIRI_E2E_LAUNCH_TARGET: z.string().min(1).optional(), // honoured only with HARAKIRI_E2E=1

// main/launcher.ts
export interface LauncherDeps {
  readonly where: () => LauncherWhere;
  readonly openExternal: (url: string) => Promise<void>;
  readonly tmpDir: string | undefined;
}
export const createLauncher: (deps: LauncherDeps) => {
  readonly status: () => Promise<LauncherStatus>;
  readonly add: () => Promise<LauncherAddResult>; // single flight: a call while one runs gets the same promise
  readonly healAtStart: () => Promise<void>; // never rejects; logs the HealReport at info when anything changed
};
export const launcher: ReturnType<typeof createLauncher>; // the app's instance
```

The app's instance:

- `where().target` is `env.HARAKIRI_E2E_LAUNCH_TARGET` when `isE2E`. Otherwise it is `ownAppImage({ appImage: env.APPIMAGE, appDir: env.APPDIR, execPath: process.execPath })`.
- `where().userData` is `app.getPath("userData")`.
- When `isE2E`, `openExternal` appends `${url}\n` to `<userData>/e2e-opened-urls.txt` and `tmpDir` is `userData`. Otherwise `openExternal` is `shell.openExternal` and `tmpDir` is `undefined`.
- `status` maps the state to the schema with `name: launcherName`, using ts-pattern `.exhaustive()`.

- [ ] **Step 1: Write the failing tests**

`launcher.test.ts`, with fake `where` and `openExternal`, and a real temp `userData` and HOME. HOME is passed by building the facts through the Task 3 fixture. If `host/index.ts` reads `process.env` directly, set `vi.stubEnv("HOME", home)`.

```ts
it("two presses while one add runs open the URL once and share the result", async () => {
  // openExternal resolves after the second add() is called and writes the shortcut
  const [a, b] = await Promise.all([launcher.add(), launcher.add()]);
  expect([a, b]).toStrictEqual([{ state: "added" }, { state: "added" }]);
  expect(opened).toHaveLength(1);
});
it("after one add settles, another may start", async () => {
  /* … */
});
it("status carries the launcher's name", async () => {
  expect(await launcher.status()).toStrictEqual({ state: "offered", name: "Steam" });
});
it("healAtStart never rejects, even when userData is unwritable", async () => {
  /* chmod 0500 */
});
```

`preload/bridge.test.ts`: a reply of `{ state: "offered", name: "Steam" }` parses. `{ state: "offered" }` is rejected. `{ state: "failed", reason: "x" }` parses for `add`.

- [ ] **Step 2: Run them to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/launcher.test.ts apps/desktop/src/preload`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `ipc.ts`: `handle(channels.launcherStatus, async () => await launcher.status())` and `handle(channels.launcherAdd, async () => await launcher.add())`.
- Preload: `launcher: { status: async () => await invoke(channels.launcherStatus, LauncherStatus), add: async () => await invoke(channels.launcherAdd, LauncherAddResult) }`.
- `index.ts`: after `createWindow()`, add `void launcher.healAtStart();`, next to `void logHost();`.
- `lint-host.ts`: replace "The Add to Steam plan extends this list." with "Launcher code (host/steam) is under host/, so it needs no entry here."

- [ ] **Step 4: Run the tests to see them pass, then run `mise run check`**

Expected: PASS. `lint-host` passes, because no file outside `host/` names the platform.

- [ ] **Step 5: Commit**

`feat(desktop): expose adding harakiri to the launcher over IPC, and heal it at startup`

---

### Task 7: The library card and the Settings action (impeccable loop)

**Files:**

- Create: `apps/desktop/src/renderer/src/launcher/launcher-card.tsx`, `launcher/queries.ts`, `launcher/dismissal.ts`
- Modify: `apps/desktop/src/renderer/src/library/library-screen.tsx` (render `<LauncherCard />` inside `<main>`)
- Modify: `apps/desktop/src/renderer/src/settings/settings-screen.tsx`
- Test: `apps/desktop/src/renderer/src/launcher/launcher-card.test.tsx`, `launcher/dismissal.test.ts`

**Interfaces:**

- Consumes: `window.harakiri.launcher` (Task 6).
- Produces:

```ts
// queries.ts
export const launcherStatusQuery: { queryKey: ["launcher", "status"]; queryFn: () => Promise<LauncherStatus>; staleTime: number /* Infinity */ };
/** useMutation over launcher.add(); on settle, invalidates ["launcher", "status"]. */
export const useAddToLauncher: () => UseMutationResult<LauncherAddResult, Error, void>;
/** The line to show under the action for a result, or null when there is nothing to say. */
export const addOutcomeLine: (name: string, result: LauncherAddResult | undefined, pending: boolean) => string | null;

// dismissal.ts: localStorage key "harakiri:launcher-card:v1", value "dismissed"; every access in try/catch
export const isDismissed: () => boolean; // storage unavailable → false
export const dismiss: () => void; // storage unavailable → no-op
```

- `addOutcomeLine` gives `Adding to {name}…` while pending, the timed-out and failed copy from Global Constraints, and `null` for `added`.

Behaviour:

- The card shows when the status is `offered` and `isDismissed()` was false at mount. Read it with a lazy `useState` initializer, and derive `shown` during render, never in an effect.
- When it appears, focus moves to `Add to {name}` (`focusKey: "launcher-add"`).
- While it shows, it claims `back`, which acts as Not now, and a `useNavigationGuard` keeps the d-pad on its two actions.
- Not now calls `dismiss()`, hides the card, and sends focus to `hero-play`.
- An `added` result hides the card once the status refetches.
- Settings shows the `Add to {name}` ListAction when the status is `offered`, whether or not the card was dismissed, with `addOutcomeLine` as its live detail. When the status is `added`, Settings shows a `{name}` / `harakiri is in your library` row in the `dl`. When `unavailable`, Settings shows neither.

- [ ] **Step 1: Write the failing tests**

`launcher-card.test.tsx` (happy-dom, a fresh `QueryClient`, `window.harakiri` stubbed with only `launcher`, `startSpatial`/`stopSpatial` as in `ui/focus.test.tsx`):

```ts
it.each(["unavailable", "added"])("shows nothing when the launcher is %s", async (state) => {
  /* … */
});
it("offers the launcher by the name main sends", async () => {
  expect(await screen.findByText("Play harakiri from Steam")).toBeVisible();
  expect(getCurrentFocusKey()).toBe("launcher-add");
});
it("Not now hides it and it stays hidden on the next mount", async () => {
  /* click Not now; unmount; mount → absent */
});
it("a timed-out add says to open the launcher and try again", async () => {
  // add resolves { state: "timedOut" } → "Steam did not list harakiri in time. Open Steam, then try again."
});
it("a failed add shows the reason", async () => {
  /* "Could not add harakiri to Steam: EACCES" */
});
```

`dismissal.test.ts`: a round trip, and a throwing `localStorage` getter gives `false` and a silent `dismiss`.

- [ ] **Step 2: Run them to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/renderer/src/launcher`
Expected: FAIL.

- [ ] **Step 3: Impeccable context and craft floor**

Load `impeccable` and run `context --target apps/desktop`. Read the craft floor before editing. The card follows the design discussion's sketch (Q13): a title, two body lines, `[ Add to Steam ]` as a `QuietAction` and `[ Not now ]`. Play stays the only red action. The critique decides its placement on the library, but it must not cover the hero's Play.

- [ ] **Step 4: Implement `queries.ts`, `dismissal.ts`, `launcher-card.tsx`, then the Settings row**

The copy comes only from Global Constraints, with `{name}` from the status.

- [ ] **Step 5: Run the tests to see them pass**

Same command. Expected: PASS.

- [ ] **Step 6: Detector, critique, audit**

Run the impeccable detector on `launcher/`, `library-screen.tsx` and `settings-screen.tsx`. Then critique and audit the card and the Settings row at 1920×1080 with a gamepad's d-pad. Fix what they find, then run Step 5 again.

- [ ] **Step 7: Run `mise run check`**

Expected: PASS. `lint-host` stays clean, because no renderer file spells the platform.

- [ ] **Step 8: Commit**

`feat(desktop): offer to add harakiri to the launcher from the library and Settings`

---

### Task 8: e2e: an empty HOME by default, and `steam.spec.ts`

**Files:**

- Modify: `apps/desktop/e2e/support/harakiri.ts` (a `homeDir` fixture, `HOME` in the launch env)
- Create: `apps/desktop/e2e/steam.spec.ts`

**Interfaces:**

- Consumes: `encodeShortcuts` (`src/main/host/steam/fixtures/vdf.ts`), `fakeSteamRoot` (`src/main/host/fixtures/steam-root.ts`), `HARAKIRI_E2E_LAUNCH_TARGET` (Task 6).
- Produces: the `homeDir` test fixture, `<userDataDir>/home` created empty. Every launch sets `HOME: homeDir`, before `...extraEnv`.

- [ ] **Step 1: Write the spec**

```ts
test.use({ extraEnv: { HARAKIRI_E2E_LAUNCH_TARGET: "/opt/harakiri/harakiri-x86_64.AppImage" } });

test("with Steam present, Add writes the launcher, asks Steam, and puts the art in grid/", async ({
  launch,
  signIn,
  homeDir,
  userDataDir,
}) => {
  fakeSteamRoot(homeDir, { "12345678": null });
  signIn();
  const { page } = await launch();
  await expect(page.getByText("Play harakiri from Steam")).toBeVisible();
  await expectFocus(page, "Add to Steam");
  await page.keyboard.press("Enter");
  // until e2e-opened-urls.txt holds the URL for <userDataDir>/steam/harakiri.desktop
  // the script is 0755 and execs '/opt/harakiri/harakiri-x86_64.AppImage'; the .desktop has NoDisplay=true
  // then write userdata/12345678/config/shortcuts.vdf: { appId: 3_141_592_653, appName: "harakiri", exe: `"${script}"` }
  await expect(page.getByText("Play harakiri from Steam")).toBeHidden({ timeout: 10_000 });
  // grid/ holds 3141592653p.png, 3141592653.png, 3141592653_hero.png, 3141592653_logo.png
  // <userDataDir>/addnonsteamgamefile is gone
});

test("Not now hides the card across a restart, and Settings still offers Add to Steam", async (
  /* … */
) => {
  // Escape on the card → hidden, focus "Play …"/"Resume …"; relaunch → no card;
  // ArrowUp, Enter → Settings shows the "Add to Steam" action
});

test("without Steam there is no card and no Settings action", async (/* … */) => {
  /* empty HOME */
});
```

- [ ] **Step 2: Build and run the whole suite**

Run: `mise run e2e`
Expected: PASS, including every existing spec under the empty HOME. If a spec fails, compare it against `main` before blaming this change (memory: the held-Down spec fails on a fresh container).

- [ ] **Step 3: Commit**

`test(e2e): add harakiri to a fake Steam, and give every spec an empty HOME`

---

### Task 9: In the guest, the launcher really drops the preload (needs Phase 4 merged)

Start this task only after Phase 4 has merged `**/*.platform.test.{ts,tsx}`, `mise run test:platform` and `dev/vm/guest.sh`. Tasks 1 to 8 merge without it.

**Files:**

- Create: `apps/desktop/src/main/host/steam/launcher.platform.test.ts`

**Interfaces:**

- Consumes: `launcherFiles`, `writeLauncher` (Task 4), and the platform tier's in-guest guard. Copy the guard from the first Phase 4 platform test (`audio-output.platform.test.ts`). Outside the guest, the test throws naming `mise run test:platform`.

- [ ] **Step 1: Write the test**

The target is `/usr/bin/sleep`, a real ELF that the guest has. The script's job is the environment and the `exec`, and a stand-in proves both without packaging the AppImage in the guest. harakiri's own GPU process under Steam's real preload stays a manual HTPC check.

```ts
it("the written launcher drops LD_PRELOAD and becomes the target under the same PID", async () => {
  const files = launcherFiles(mkdtempSync(path.join(tmpdir(), "harakiri-launcher-")));
  await writeLauncher(
    files,
    "/usr/bin/sleep",
    path.resolve(import.meta.dirname, "../../../../build/steam")
  );
  const child = spawn(files.script, ["30"], {
    env: {
      ...gamescopeSession,
      PATH: "/usr/bin:/bin",
      LD_PRELOAD: "/opt/fake/gameoverlayrenderer.so",
    },
  });
  // until /proc/<child.pid>/exe resolves to /usr/bin/sleep (the exec happened)
  const environ = readFileSync(`/proc/${child.pid}/environ`, "utf-8").split("\0");
  expect(environ.some((entry) => entry.startsWith("LD_PRELOAD="))).toBe(false);
  expect(environ).toContain("XDG_CURRENT_DESKTOP=gamescope");
  child.kill();
});
```

`gamescopeSession` comes from `host/fixtures/environments.ts`. The `.so` path does not exist: the loader warns and goes on, which is all the test needs.

- [ ] **Step 2: Run it outside the guest to see it fail loudly**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --config vitest.tiers.config.ts --project 'platform:*' --maxWorkers=2 apps/desktop/src/main/host/steam`
Expected: FAIL, naming `mise run test:platform`.

- [ ] **Step 3: Run it in the guest**

Run: `mise run test:platform`
Expected: PASS. To see it fail, delete `unset LD_PRELOAD` from `launcherScript` locally once, then restore it.

- [ ] **Step 4: Commit**

`test(platform): the Steam launcher drops the overlay preload in the guest`

---

## Order

Tasks 1 and 2 have no dependencies. Task 3 needs 2. Task 4 needs 1 and 3. Task 5 needs 3 and 4, and Task 6 needs 5. Task 7 needs 6, and Task 8 needs 7. Task 9 needs Task 4 and Phase 4. Task 1 touches only `build/`, packaging and `doctor`, so it can run beside Tasks 2 and 3.

## After the release: checks on the HTPC

These are Q13's checks, run once the updater has installed a release with Tasks 1 to 8:

- [ ] In Desktop Mode and in Game Mode, the card's "Add to Steam" adds harakiri with its artwork, and Steam needs no restart. Note whether the art shows at once or only after Steam restarts.
- [ ] Steam keeps `~/.config/harakiri/steam/harakiri.sh` as the shortcut's target. Note how `shortcuts.vdf` stores `Exe` (quoted or not), and whether the shortcut has harakiri's icon.
- [ ] Launched from the shortcut, the run log has no `GPU process is gone` line, and the UI is GPU-rendered.
- [ ] Steam shows harakiri as running. "Stop" closes harakiri and mpv, and nothing still shows as running after harakiri quits.
- [ ] The Quick Access menu still opens over harakiri and mpv.
- [ ] With Steam closed, Add starts Steam. Note whether it lists harakiri within 30 s, and whether `/tmp/addnonsteamgamefile` is gone afterwards.
