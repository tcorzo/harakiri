---
task: 2026-11-20-bazzite-plug-and-play
type: plan
repo: harakiri
branch: tcorzo/bazzite-first-party
sha: 759eb96b499d6d3d687aef98b3e61734001a72a3
---

**Repos touched:** `harakiri`

# Bazzite plug and play, part 1: the app-side fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first public release, then fix bitstream detection, mpv start errors, keyring-less sign-in, the HDR hint and downscale reporting, so the HTPC gets each fix through the updater.

**Architecture:** The plan follows the outline's Phases 1, 2, 3, 5 and 6. A new `apps/desktop/src/main/host/` module reads the platform once and answers capabilities named by behaviour. The session store asks it `secretStore`. The fidelity engine takes `hdrSignalling` as a `PictureWorld` input and returns the colorspace hint. `scripts/lint-host.ts` keeps platform names out of feature code.

**Tech Stack:** Electron 45.1.0 (async `safeStorage`), TypeScript 7, vitest 5 (`--maxWorkers=2`), Playwright e2e under nested KWin, zod 4, ts-pattern, LogTape, bun scripts.

**Spec:** `docs/tasks/2026-11-20-bazzite-plug-and-play/03-structure-outline-bazzite-plug-and-play.md` (phases), `02-design-discussion-bazzite-plug-and-play.md` (decisions Q2, Q5, Q7, Q9, Q10). The outline wins where they differ.

**Not in this plan:** outline Phases 4 (microVM guest), 7 and 8 (bundled mpv), 9 (DV 7 FEL), 10 (Add to Steam) and 11 (docs and the HTPC check). Each depends on an open question in the outline or on new infrastructure, and each gets its own plan. The outline's `*.platform.test.ts` checks for Phases 5 and 6 move into the Phase 4 plan.

**Contracts:** `05-contracts-and-waves.md` lists the shared interfaces that wave 0 has already landed in code, with stub bodies, and the waves that run the tasks in parallel. A task fills in only the stubs it owns, and never changes a frozen shape. Where this plan's file lists and 05 differ, 05 wins.

## Decisions this plan makes beyond the outline

- **The no-keyring token is plain base64, marked `obfuscated`, in a 0600 file, without `safeStorage`.** The design says "written with safeStorage's basic_text backend". But `basic_text` uses a hardcoded key that anyone can read in Chromium's source, so it adds no protection over base64. And when a keyring backend is selected but unavailable, `encryptStringAsync` throws, so it would not always work. The 0600 mode is the real protection in both cases. A side effect: a file written in Game Mode also loads in Desktop Mode on the same machine.
- **The storage kind reaches the renderer through a new `session.storage()` call, not as a field on `Session`.** `Session` feeds `NewSession` and the e2e equality checks, and the preload's zod parse would strip an extra field.
- **The `outputSize` observation carries both sizes: `{ output, picture }`.** The engine knows no video size, and mpv reports both sizes. `picture` is mpv's `video-params` `dw`×`dh`, the display size after aspect correction.
- **The Picture section of `compatibility.md` gains a "Colorspace hint" table**, so the hint change shows up in the reviewed diff.

## Global Constraints

- Run every test suite through the bounded runner: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 <paths>`. A local hook rejects vitest without `--maxWorkers`. e2e runs only as `mise run e2e`, and only at a wave gate, run by the integrator (05).
- Commits are Conventional Commits, and each ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only the task's files.
- Tests never skip (`scripts/lint-skips.ts`). Nothing committed holds home-directory paths, owner domains or library titles (`scripts/lint-private.ts`).
- Fidelity decisions live in `packages/fidelity`. Any engine change runs `mise run fidelity:table` and commits the `docs/fidelity/compatibility.md` diff (`table.test.ts` compares bytes).
- mpv output lines pass through `redactSecrets` before they reach a log, an error or the screen.
- Electron 45 deprecates the synchronous `safeStorage` calls, and Electron 46 removes them. Use `encryptStringAsync`, `decryptStringAsync` and `isAsyncEncryptionAvailable`.
- zod only at IO edges. Use ts-pattern `.exhaustive()` for new union matches.
- All web UI changes go through the impeccable loop (CLAUDE.md): `context --target apps/desktop`, the craft floor, the detector, then critique.
- Exact copy:
  - `update feed unreachable (HTTP 404); tries again later` (the status is 404 or 401)
  - `Signed in on this device without a keyring`
  - `Scaled down to 1920×1080 by the output.` (`×` is U+00D7)
- Electron reports the `safeStorage` backend only after `app.whenReady()`. Read host facts after ready.

## Review Focus

1. **A session saved with a keyring, read without one.** On the HTPC, Desktop Mode (KWallet) and Game Mode (no keyring) share `userData`. Expected: `load` returns `null` and logs the error, with no crash. The next sign-in writes `obfuscated`, and both modes then read it. Pinned in Task 6.
2. **mpv's fatal line carries a token**, for example `Failed to open http://…?api_key=…`. Expected: the error and the screen show `api_key=REDACTED`. Pinned in Task 4.
3. **mpv prints many matching lines before it exits.** Expected: the message keeps only the last 3 fatal lines, without `[module]` prefixes, so the notice stays readable. Pinned in Task 4.
4. **`osd-dimensions` is 0×0 or unavailable, or a letterboxed film plays on a larger output.** Examples: before the video output is up, or 3840×1608 on 3840×2160. Expected: no downgrade. Pinned in Task 9.
5. **A sink lists an encoding that harakiri does not bitstream** (`mpeg-iec61937, format.rate = …`), an attribute with no space after the comma, or only `pcm`. Expected: the unknown encoding is ignored, and `pcm` alone gives `[]`. Pinned in Task 3.

---

### Task 1: The updater reports an unreachable feed as one warning (#15)

**Files:**

- Modify: `apps/desktop/src/main/updates.ts:157-159` (the `onError` listener), plus a new exported helper
- Modify: `apps/desktop/src/main/updater.ts` (the `real.logger.error` adapter)
- Test: `apps/desktop/src/main/updates.test.ts`, `apps/desktop/src/main/updater.test.ts`

**Interfaces:**

- Produces: `feedUnreachable(error: unknown): 401 | 404 | undefined` in `updates.ts`. It returns the status when `error` is an object whose `statusCode` is 401 or 404. Otherwise it returns the status when `String(error)` matches `/\bHttpError: (?<status>401|404)\b/u`. Otherwise it returns `undefined`.

- [ ] **Step 1: Write the failing tests**

In `updates.test.ts`, add a `describe(feedUnreachable)` block and two `startUpdates` cases. Capture records with a LogTape memory sink, configured as in `packages/mpv/src/client.test.ts:254-275` (`configure({ reset: true, … })` in `beforeAll`, `reset()` in `afterAll`).

```ts
describe(feedUnreachable, () => {
  it.each([
    [Object.assign(new Error("404 Not Found"), { statusCode: 404 }), 404],
    [Object.assign(new Error("401 Unauthorized"), { statusCode: 401 }), 401],
    [new Error(ISSUE_15_MESSAGE), 404], // the exact text from `gh issue view 15`, scrubbed by lint-private
    [new Error("net::ERR_INTERNET_DISCONNECTED"), undefined],
    [Object.assign(new Error("500"), { statusCode: 500 }), undefined],
  ])("%s → %s", (error, status) => {
    expect(feedUnreachable(error)).toBe(status);
  });
});

it("a 404 from the feed fails the check with one plain warning and no error", async () => {
  // start(fake); fire fake.on.error(Object.assign(new Error(ISSUE_15_MESSAGE), { statusCode: 404 }))
  expect(updates.status()).toStrictEqual({
    state: "failed",
    message: "update feed unreachable (HTTP 404)",
  });
  expect(records.filter((r) => r.level === "warning").map((r) => r.message.join(""))).toStrictEqual(
    ["update feed unreachable (HTTP 404); tries again later"]
  );
  expect(records.filter((r) => r.level === "error")).toStrictEqual([]);
});

it("a 404 is retried like any failed check", async () => {
  /* as "retries a failed check 15 minutes after it started", with the 404 error */
});
```

In `updater.test.ts`, add this case. The adapter's `logger.error` gets electron-updater's text for a 404. Expect it at debug, not error: `fake.logger?.error(ISSUE_15_MESSAGE)` leaves no `error` record and one `debug` record. Another text, such as `"Error: EACCES"`, still logs at error.

- [ ] **Step 2: Run the tests to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/updates.test.ts apps/desktop/src/main/updater.test.ts`
Expected: FAIL. `feedUnreachable` is not exported, and the 404 status message is the raw text.

- [ ] **Step 3: Implement**

- `onError`: when `feedUnreachable(failure)` gives a status, `set({ state: "failed", message: \`update feed unreachable (HTTP ${status})\` })`, then `log.warn("update feed unreachable (HTTP {status}); tries again later", { status })`. Otherwise keep today's path.
- In the adapter, `real.logger.error` sends a message for which `feedUnreachable(message)` is defined to `log.debug`.

- [ ] **Step 4: Run the tests to see them pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

`fix(updates): report an unreachable update feed as one warning`

---

### Task 2: Go public under MIT and cut v0.1.0

**Files:**

- Create: `LICENSE` (MIT, `Copyright (c) 2026 tcorzo`)
- Modify: `package.json` and `apps/desktop/package.json` (`"license": "MIT"`)
- Modify: `README.md:45` (install) and the end of the file (licence line)

**Interfaces:** none.

- [ ] **Step 1: Write the licence and the README lines**

- README `:45`: "Each GitHub release ships one Linux x64 AppImage. Until harakiri bundles its own mpv, it uses the system mpv, so install `mpv` 0.41 or newer and `ffmpeg` from RPM Fusion first."
- New `## License` section: "MIT. See [LICENSE](LICENSE)."

- [ ] **Step 2: Verify**

Run: `mise run check && mise run package && mise run package:check`
Expected: all pass. `package:check` still reports the public GitHub feed.

- [ ] **Step 3: Commit**

`docs: license harakiri under MIT`

- [ ] **Step 4: Owner actions (not automatable)**

1. Make the repo public.
2. Merge the release-please PR. If it proposes a version other than `0.1.0`, add `"release-as": "0.1.0"` to the `"."` package in `release-please-config.json` first.
3. Check: `gh release view v0.1.0 --json assets -q '.assets[].name'` lists `harakiri-x86_64.AppImage` and `latest-linux.yml`.

---

### Task 3: Bitstream works with attribute-suffixed formats (#8)

**Files:**

- Modify: `apps/desktop/src/main/player/audio-output.ts:45`
- Create: `apps/desktop/src/main/player/fixtures/pactl-fake-spdif.json`
- Test: `apps/desktop/src/main/player/audio-output.test.ts`

**Interfaces:**

- Produces: `encodingOf(format: string): string`, exported from `audio-output.ts`. It returns the text before the first comma, trimmed.

- [ ] **Step 1: Record the fixture**

The fixture is `{ "info": { "default_sink_name": "fake-spdif" }, "sinks": [ … ] }`. Its `formats` are exactly the strings from research §13.2:

```json
"pcm",
"dts-iec61937, format.rate = \"{ \\\"min\\\": 1, \\\"max\\\": -1 }\"",
"ac3-iec61937, format.rate = \"{ \\\"min\\\": 1, \\\"max\\\": -1 }\"",
"eac3-iec61937, format.rate = \"{ \\\"min\\\": 1, \\\"max\\\": -1 }\"",
"truehd-iec61937, format.rate = \"{ \\\"min\\\": 1, \\\"max\\\": -1 }\"",
"dtshd-iec61937, format.rate = \"{ \\\"min\\\": 1, \\\"max\\\": -1 }\""
```

The sink is `{ "name": "fake-spdif", "description": "Fake S/PDIF", … }`.

- [ ] **Step 2: Write the failing tests**

```ts
it("PipeWire's attribute-suffixed formats still name their codecs", () => {
  const { info, sinks } = JSON.parse(
    readFileSync(new URL("fixtures/pactl-fake-spdif.json", import.meta.url), "utf-8")
  );
  expect(outputFromPactl(info, sinks)).toStrictEqual({
    kind: "known",
    name: "Fake S/PDIF",
    bitstream: ["dts", "ac3", "eac3", "truehd", "dts-hd"],
  });
});

it.each([
  ['truehd-iec61937,format.rate = "…"', "truehd-iec61937"],
  ['  ac3-iec61937 , format.channels = "6"', "ac3-iec61937"],
  ["pcm", "pcm"],
])("encodingOf(%j) is %j", (format, encoding) => {
  expect(encodingOf(format)).toBe(encoding);
});

it("an encoding harakiri does not bitstream is ignored, attributes or not", () => {
  // formats: ["pcm", "mpeg-iec61937, format.rate = \"…\""] → bitstream []
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/player/audio-output.test.ts`
Expected: FAIL. `bitstream` is `[]`, and `encodingOf` is not exported.

- [ ] **Step 4: Implement**

Look up `CODEC_BY_FORMAT.get(encodingOf(format))`.

- [ ] **Step 5: Run the tests to see them pass, then run `mise run check`**

Expected: PASS.

- [ ] **Step 6: Commit**

`fix(audio): bitstream when PipeWire lists formats with attributes`

---

### Task 4: When mpv does not start, the error carries mpv's reason (#12)

**Files:**

- Create: `packages/mpv/src/start-error.ts` (one file per error, like `closed-error.ts`)
- Modify: `packages/mpv/src/client.ts:322-375` (`spawnMpv`), `client.ts:27` (re-export), `packages/mpv/src/index.ts` (export)
- Test: `packages/mpv/src/client.test.ts`, `apps/desktop/e2e/screening.spec.ts`

**Interfaces:**

- Produces:

```ts
// packages/mpv/src/start-error.ts
/** mpv exited before its IPC socket was ready. */
export class MpvStartError extends Error {
  readonly name = "MpvStartError";
  constructor(readonly exit: MpvExit, readonly fatal: readonly string[]);
  // message: fatal.join(" ") when fatal is non-empty,
  //          else `mpv exited before its IPC socket was ready (code ${exit.code ?? exit.signal})`
}
/** The last 3 lines matching /Error|Fatal|failed/u, without a leading "[module] " tag. Input is already redacted. */
export const fatalLines = (tail: readonly string[]): string[];
```

- `spawnMpv` keeps the last 20 redacted output lines from both streams.
- On `exit` before the socket connects, `spawnMpv` waits for both readline interfaces to close, so mpv's last lines are in the tail, and then rejects with `MpvStartError`.
- When `connectWhenReady` loses the race after mpv exited, the catch throws the `MpvStartError` instead of the raw connect error.
- A spawn `error` (ENOENT) still rejects with Node's error.

- [ ] **Step 1: Write the failing tests**

Add a `describe("when mpv does not start")` block to `client.test.ts`. A helper `standIn(script: string): Promise<string>` writes `#!/bin/sh\n${script}` to a `mkdtemp` dir with mode 0o755. `afterAll` removes the dir. These tests call `spawnMpv` directly, not `start()`.

```ts
it("the error carries mpv's fatal line", async () => {
  const binary = await standIn(
    'echo "[cplayer] Error parsing option input-gamepad (option not found)"\nexit 1'
  );
  const error = await rejectionOf(spawnMpv({ config: "none", binary }));
  expect(error).toBeInstanceOf(MpvStartError);
  expect(error.message).toBe("Error parsing option input-gamepad (option not found)");
  expect((error as MpvStartError).exit).toStrictEqual({ code: 1, signal: null });
});

it("with nothing fatal in the output, the message names the exit code", async () => {
  // standIn("exit 1") → message "mpv exited before its IPC socket was ready (code 1)"
});

it("keeps only the last three fatal lines", async () => {
  // five `echo "Error N"` lines, then exit 1 → message "Error 3 Error 4 Error 5"
});

it("a token in mpv's output never reaches the error", async () => {
  // echo "Failed to open http://127.0.0.1:1/v.mkv?api_key=s3cretTok3n9f" → message contains "api_key=REDACTED", not the token
});

it("a missing binary still fails with ENOENT", async () => {
  // binary: path.join(dir, "absent") → error.code === "ENOENT", not an MpvStartError
});

it("real mpv rejecting an option says which one", async () => {
  // start(["--vo=null", "--harakiri-no-such-option"]) rejects; message contains "harakiri-no-such-option"
});
```

Add this to `screening.spec.ts`, in a `test.describe` with `test.use({ mpvArgs: "--vo=null --ao=null --harakiri-no-such-option" })`. Reach a title and press play as in the file's first test (`leadContinueWatching`, `openFirstResumed`, `Enter`). Then:

```ts
await expect(page.getByText(/It did not start\. .*harakiri-no-such-option/u)).toBeVisible({
  timeout: 15_000,
});
await expectFocus(page, "Back to the programme");
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 packages/mpv/src/client.test.ts`
Expected: FAIL. `MpvStartError` is not exported.

- [ ] **Step 3: Implement `MpvStartError`, `fatalLines` and the `spawnMpv` changes in the Interfaces block**

- [ ] **Step 4: Run the tests to see them pass**

Run the same command. Expected: PASS. At the wave gate, the integrator runs `mise run e2e`, and the new screening test shows mpv's line.

- [ ] **Step 5: Commit**

`fix(player): show mpv's own reason when it fails to start`

---

### Task 5: The host module: facts and capabilities

**Files:**

- Create: `apps/desktop/src/main/host/facts.ts`, `host/capabilities.ts`, `host/index.ts`, `host/fixtures/environments.ts`
- Test: `apps/desktop/src/main/host/host.test.ts`

**Interfaces:**

- Produces:

```ts
// host/facts.ts: the only reader of XDG_*, GAMESCOPE_*, WAYLAND_DISPLAY and the safeStorage backend
export interface SecretProbe {
  getSelectedStorageBackend: () => string;
  isAsyncEncryptionAvailable: () => Promise<boolean>;
}
export interface HostFacts {
  readonly gamescopeDisplay: string | undefined;   // GAMESCOPE_WAYLAND_DISPLAY
  readonly waylandDisplay: string | undefined;     // WAYLAND_DISPLAY
  readonly desktop: readonly string[];             // XDG_CURRENT_DESKTOP split on ":", empty entries dropped
  readonly secretBackend: string;
  readonly encryptionAvailable: boolean;
}
export const readHostFacts: (env: Readonly<Record<string, string | undefined>>, secrets: SecretProbe) => Promise<HostFacts>;

// host/capabilities.ts
export type SecretStore = "keyring" | "file";
export interface HostCapabilities { readonly secretStore: SecretStore; readonly hdrSignalling: HdrSignalling }
export const capabilitiesOf: (facts: HostFacts) => HostCapabilities;
// secretStore is "keyring" iff encryptionAvailable && secretBackend is not "basic_text" or "unknown"
// hdrSignalling is "swapchain-formats" iff gamescopeDisplay !== undefined && (waylandDisplay === undefined || waylandDisplay === gamescopeDisplay)

// host/index.ts: Electron's instance, memoized; call only after app.whenReady()
export const hostFacts: () => Promise<HostFacts>;          // readHostFacts(process.env, safeStorage)
export const hostCapabilities: () => Promise<HostCapabilities>;
```

- `fixtures/environments.ts` exports `gamescopeSession`: the Game Mode environment from research §1 (`XDG_CURRENT_DESKTOP: "gamescope"`, `XDG_SESSION_TYPE: "x11"`, `DISPLAY: ":1"`, `ENABLE_GAMESCOPE_WSI: "1"`, `GAMESCOPE_WAYLAND_DISPLAY: "gamescope-0"`, no `WAYLAND_DISPLAY`).
- It also exports `plasmaWayland` (`XDG_CURRENT_DESKTOP: "KDE"`, `XDG_SESSION_TYPE: "wayland"`, `WAYLAND_DISPLAY: "wayland-0"`).
- And `secrets(backend: string, available: boolean): SecretProbe`.

- [ ] **Step 1: Write the failing tests**

```ts
it("reads Game Mode's facts", async () => {
  expect(await readHostFacts(gamescopeSession, secrets("basic_text", true))).toStrictEqual({
    gamescopeDisplay: "gamescope-0",
    waylandDisplay: undefined,
    desktop: ["gamescope"],
    secretBackend: "basic_text",
    encryptionAvailable: true,
  });
});
it("splits XDG_CURRENT_DESKTOP on colons", async () => {
  /* "ubuntu:GNOME" → ["ubuntu", "GNOME"]; "" → [] */
});
it.each([
  ["basic_text", true, "file"],
  ["unknown", true, "file"],
  ["gnome_libsecret", false, "file"],
  ["kwallet6", true, "keyring"],
  ["gnome_libsecret", true, "keyring"],
])("backend %s, available %s → secretStore %s", async (backend, available, store) => {
  expect(
    capabilitiesOf(await readHostFacts(plasmaWayland, secrets(backend, available))).secretStore
  ).toBe(store);
});
```

`hdrSignalling` cases, in the same file:

- `gamescopeSession` gives `"swapchain-formats"`.
- `plasmaWayland` gives `"colour-management"`.
- `{ ...gamescopeSession, WAYLAND_DISPLAY: "wayland-1" }` gives `"colour-management"`, because a nested Wayland client is not on gamescope's X11 path.

- [ ] **Step 2: Run the tests to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/host`
Expected: FAIL (the modules are missing).

- [ ] **Step 3: Replace the `readHostFacts` and `capabilitiesOf` stubs, then log the host after ready**

Wave 0 landed the types, the signatures and `host/index.ts`. Only the two stub bodies change.

In `apps/desktop/src/main/index.ts`, after `await app.whenReady()` (`:149`), log at info: `logger.info("host {facts}; capabilities {capabilities}", { facts: await hostFacts(), capabilities: await hostCapabilities() })`.

- [ ] **Step 4: Run the tests to see them pass, then run `mise run typecheck`**

Expected: PASS.

- [ ] **Step 5: Commit**

`feat(desktop): read host facts once and answer capabilities`

---

### Task 6: Without a keyring, the session is kept in a 0600 file (#11)

**Files:**

- Modify: `apps/desktop/src/main/session.ts` (whole store; drop `isE2E`)
- Modify: `apps/desktop/src/main/ipc.ts:48-57`
- Modify: `apps/desktop/src/shared/bridge.ts` (`channels`, the `SessionStorage` schema, `HarakiriBridge.session`)
- Modify: `apps/desktop/src/preload/bridge.ts:58-66`, `apps/desktop/src/preload/bridge.test.ts`
- Modify: `apps/desktop/src/renderer/src/settings/settings-screen.tsx`
- Modify: `apps/desktop/e2e/support/jellyfin.ts:65-73` (`seedSession`), `apps/desktop/e2e/support/harakiri.ts:173-193` (launch env)
- Modify: `apps/desktop/src/main/player/index.ts`: pass the now-async `loadSession` directly, in place of wave 0's `Promise.resolve` wrapper. `PlayerWiring.loadSession` is already async.
- Modify: `docs/PRD.md` (onboarding, near `:65`)
- Test: `apps/desktop/src/main/session.test.ts`, `apps/desktop/e2e/session.spec.ts`

**Interfaces:**

- Consumes: `SecretStore` and `hostCapabilities()` from Task 5.
- Produces:

```ts
// session.ts
export interface TokenCrypto {
  encryptStringAsync: (plain: string) => Promise<Buffer>;
  decryptStringAsync: (encrypted: Buffer) => Promise<{ result: string; shouldReEncrypt: boolean }>;
}
export interface SessionStoreOptions { dir: string; crypto: TokenCrypto; secretStore: SecretStore }
export interface SessionStore {
  load: () => Promise<Session | null>;
  save: (session: NewSession) => Promise<void>;
  clear: () => void;
  deviceId: () => DeviceId;
  storage: () => SecretStore;
}
// StoredToken: {kind: "encrypted", base64} | {kind: "obfuscated", base64}   ("plain" is gone)
export const loadSession: () => Promise<Session | null>;
export const saveSession: (session: NewSession) => Promise<void>;
export const sessionStorage: () => Promise<SecretStore>;
// clearSession and deviceId keep their signatures; the default store is built on first use from hostCapabilities()

// shared/bridge.ts
channels.sessionStorage = "session:storage"
export const SessionStorage = z.enum(["keyring", "file"]);
HarakiriBridge.session.storage: () => Promise<"keyring" | "file">
```

- `save` writes `encrypted` (from `encryptStringAsync`) when `secretStore` is `"keyring"`. Otherwise it writes `obfuscated` (base64 of the UTF-8 token).
- With `obfuscated`, the store logs `"No keyring: the session is kept in {file}, readable only by this user"` at info, once per store.
- `load` reads either kind, whatever `secretStore` is. When `shouldReEncrypt` is true, it saves again.
- The atomic 0600 write is unchanged.

- [ ] **Step 1: Rewrite the session tests against the new store**

- Fake cryptos become async: `prefixing` resolves `{ result, shouldReEncrypt: false }`, and `locked` rejects.
- `store(crypto, secretStore = "keyring")`.
- Delete the plain-text and memory-only tests.
- Make every existing test `async`.

Add:

```ts
it("without a keyring the session survives a restart through a 0600 obfuscated file", async () => {
  await store(unavailable, "file").save(newSession);
  expect(readStored()).toMatchObject({
    token: { kind: "obfuscated", base64: Buffer.from("secret-token").toString("base64") },
  });
  expect(statSync(path.join(dir, "session.json")).mode.toString(8).slice(-3)).toBe("600");
  expect(await store(unavailable, "file").load()).toStrictEqual(expectedSession);
});

it("a keyring session read where no keyring opens is null, and the next sign-in writes one both can read", async () => {
  await store(prefixing, "keyring").save(newSession);
  expect(await store(locked, "file").load()).toBeNull();
  await store(locked, "file").save(newSession);
  expect(await store(prefixing, "keyring").load()).toStrictEqual(expectedSession);
});

it("a token Electron asks to re-encrypt is written again", async () => {
  // decryptStringAsync resolves shouldReEncrypt: true → after load, encryptStringAsync was called once more and the file changed
});

it("an old plain-text file reads as null", async () => {
  /* token {kind:"plain", value} → null */
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 apps/desktop/src/main/session.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the store, then IPC, bridge and preload**

- In `ipc.ts`: make `sessionGet` and `sessionSave` await, and add `handle(channels.sessionStorage, async () => await sessionStorage())`.
- In the preload: `storage: async () => await invoke(channels.sessionStorage, SessionStorage)`.
- In `preload/bridge.test.ts`, add a case after the `session.get` case: a reply of `"file"` parses, and `"plain"` is rejected.

- [ ] **Step 4: Run the unit tests to see them pass, then run `mise run typecheck`**

Expected: PASS.

- [ ] **Step 5: Show the no-keyring line in Settings (impeccable loop)**

- Add `useQuery({ queryKey: ["session", "storage"], queryFn: async () => await window.harakiri.session.storage(), staleTime: Infinity })`.
- When the data is `"file"`, show `Signed in on this device without a keyring` with the "Signed in as" row. The impeccable critique decides the exact placement and style.
- Run the impeccable detector on `settings-screen.tsx`.

- [ ] **Step 6: Make e2e take the no-keyring path, and assert the line**

- `seedSession` writes `{ kind: "obfuscated", base64: Buffer.from(accessToken).toString("base64") }`.
- The launch env adds `"DESKTOP_SESSION"`, `"KDE_FULL_SESSION"`, `"KDE_SESSION_VERSION"` and `"GNOME_DESKTOP_SESSION_ID"` to the dropped variables. It sets `XDG_CURRENT_DESKTOP: "gamescope"` before `...extraEnv`, so Electron picks `basic_text` as it does in Game Mode.

Add to `session.spec.ts`:

```ts
test("a sign-in saved without a keyring survives a restart, and Settings says where it is kept", async ({
  launch,
  account,
  userDataDir,
}) => {
  // launch; page.evaluate save(account without deviceId); read session.json: token.kind "obfuscated", mode 600
  // relaunch; session.get() equals account
  // open Settings as navigation.spec.ts does; expect getByText("Signed in on this device without a keyring") visible
});
```

- [ ] **Step 7: Run e2e, then add the PRD sentence**

At the wave gate, the integrator runs `mise run e2e`. Expected: PASS.

PRD onboarding, after the persistence sentence at `:65`: "Where no keyring is available, as in Steam Game Mode under autologin, the token is kept in a file only this user can read. Settings says so, and the token can be revoked from the server's dashboard."

- [ ] **Step 8: Commit**

`fix(session): keep the sign-in without a keyring`

---

### Task 7: A lint keeps platform names out of feature code

**Files:**

- Create: `scripts/lint-host.ts` (modelled on `scripts/lint-private.ts`, with the same file listing, argv handling and output)
- Modify: `hk.pkl` (a `lint-host` step), `mise.toml` (a `lint:host` task, added to `check.depends`), `CLAUDE.md` (a rule-table row)

**Interfaces:**

- Produces: `bun scripts/lint-host.ts [file…]`. It exits 1 with `file:line: text\n  why`, or prints `lint-host: N file(s), none name a platform`.
- **Scope:** tracked `*.ts` and `*.tsx` under `apps/desktop/src/` and `packages/*/src/`.
- **Exempt:** `apps/desktop/src/main/host/**`, `*.test.ts(x)`, `**/fixtures/**`, `packages/harness/**`, `packages/fidelity/src/scenarios.ts`. Keep them in one `EXEMPT` list. The Add to Steam plan extends it.
- **Rules** are built with `[…].join` so the file does not match itself:
  - host env read: `/\b(?:XDG_[A-Z_]+|GAMESCOPE_[A-Z_]+|WAYLAND_DISPLAY|LD_PRELOAD)\b/u`
  - backend probe: `/\bgetSelectedStorageBackend\b/u`
  - platform name: `/gamescope|kwin|\bsteam/iu`
- No exception comment: a hit moves into `host/` or is reworded.

- [ ] **Step 1: Write the script, then run it on the tree**

Run: `bun scripts/lint-host.ts`
Expected: `lint-host: N file(s), none name a platform`. If it reports hits in existing comments or code, reword them or move them under `host/`, and name each one in the commit body.

- [ ] **Step 2: Prove that it fails**

Write a scratch `apps/desktop/src/main/zz-lint-host-probe.ts` holding `export const d = process.env.XDG_CURRENT_DESKTOP;`. Run `bun scripts/lint-host.ts apps/desktop/src/main/zz-lint-host-probe.ts`. Expected: exit 1, and the output names the file at line 1 as a host env read. Delete the scratch file.

- [ ] **Step 3: Wire it in**

- In `hk.pkl`: `["lint-host"] { glob = List("**/*.ts", "**/*.tsx"); check = "bun scripts/lint-host.ts {{files}}" }`
- In `mise.toml`: `[tasks."lint:host"]`, and add `"lint:host"` to `check.depends`.
- In `CLAUDE.md`, add this rule row:
  `| No feature code names a platform; features ask host capabilities | scripts/lint-host.ts (hk pre-commit, mise run check) |`

- [ ] **Step 4: Verify**

Run: `mise run check`. Expected: PASS, with lint-host in the output.

- [ ] **Step 5: Commit**

`chore: lint platform names out of feature code`

---

### Task 8: The engine picks the colorspace hint from `hdrSignalling` (#9)

**Files:**

- Modify: `packages/fidelity/src/model.ts`, `picture.ts`, `engine.ts:42-55,114-141` (`FidelityStart`, `startFidelity`, the `learn` `rendererFailed` branch), `index.ts`
- Modify: `packages/fidelity/src/scenarios.ts` (`displays`, `simulate`, `pictureCell`), `table.ts` (a "Colorspace hint" table), `docs/fidelity/compatibility.md` (regenerated)
- Test: `packages/fidelity/src/engine.test.ts`, `apps/desktop/src/main/player/create-player.test.ts` (one case)

Wave 0 landed every type and signature below, and the desktop plumbing (05, C2 and C3). This task replaces the `colorspaceHintFor` stub, adds the scenarios and the hint table, and adds the tests. The `hdrSignalling` host rule and its tests belong to Task 5.

**Interfaces:**

- Consumes: nothing beyond wave 0.
- Produces (already frozen; listed for reference):

```ts
// model.ts (exported from index.ts)
export type HdrSignalling = "colour-management" | "swapchain-formats";
export type ColorspaceHint = "auto" | "yes";
// picture.ts
PictureWorld += readonly hdrSignalling: HdrSignalling
export const colorspaceHintFor = (signalling: HdrSignalling): ColorspaceHint   // colour-management → "auto", swapchain-formats → "yes"
// engine.ts
FidelityStart += readonly hdrSignalling: HdrSignalling        // required
FidelityView += readonly colorspaceHint: ColorspaceHint
// host/capabilities.ts
HostCapabilities += readonly hdrSignalling: HdrSignalling
// swapchain-formats iff gamescopeDisplay !== undefined && (waylandDisplay === undefined || waylandDisplay === gamescopeDisplay)
// playback.ts
startingFidelity: (resolution: Resolution, output: AudioOutput, hdrSignalling: HdrSignalling) => FidelityState
PlaybackDeps += readonly hdrSignalling: HdrSignalling
// create-player.ts
PlayerWiring += readonly hdrSignalling: () => Promise<HdrSignalling>
// scenarios.ts
displays[number] += readonly hdrSignalling?: HdrSignalling     // default "colour-management"
simulate(picture, sound, delivery, output, observed, hdrSignalling: HdrSignalling = "colour-management")
```

The `rendererFailed` branch of `learn` spreads `state.pictureWorld`, so new world fields survive a renderer step-down.

- [ ] **Step 1: Write the failing engine tests**

```ts
it("a colour-management compositor gets the auto hint", () => {
  expect(fidelityView(start({ hdrSignalling: "colour-management" })).colorspaceHint).toBe("auto");
});
it("a swapchain-format compositor gets the yes hint, and keeps it after a renderer step-down", () => {
  const { view } = run(start({ hdrSignalling: "swapchain-formats" }), { kind: "rendererFailed" });
  expect(view.colorspaceHint).toBe("yes");
});
it("swapchain formats with HDR off is reported as an SDR display", () => {
  // run(start({ hdrSignalling: "swapchain-formats", picture: hdr10 }), {kind:"displayTarget", hdr:false})
  // → downgrades[0].message "The display takes SDR only, so HDR10 is tone-mapped to SDR."
});
```

The `start` helper already defaults to `hdrSignalling: "colour-management"`.

- [ ] **Step 2: Run the tests to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 packages/fidelity`
Expected: FAIL.

- [ ] **Step 3: Implement the engine, then add the scenarios**

New `displays` entries, after the existing four:

- `{ name: "HDR via swapchain formats, HDR on", hdrSignalling: "swapchain-formats", observed: [{ kind: "displayTarget", hdr: true }] }`
- `{ name: "HDR via swapchain formats, HDR off", hdrSignalling: "swapchain-formats", observed: [{ kind: "displayTarget", hdr: false }] }`

In `table.ts`, add `### Colorspace hint` under `## Picture`. It is a table `Setup | mpv colorspace hint`, with one row per display, from `pictureCell(<the HDR10 picture>, display).colorspaceHint`.

- [ ] **Step 4: Regenerate and review the table**

Run: `mise run fidelity:table && git diff docs/fidelity/compatibility.md`
Expected diff, and only this:

- two new display columns, in which every HDR row shows its fact in the "HDR on" column and `… tone-mapped to SDR ⬇` in the "HDR off" column
- their Why rows
- the new hint table, with `auto` for the first four setups and `yes` for the two new ones

- [ ] **Step 5: Prove the desktop passes the hint through**

Wave 0 wired `hdrSignalling` from `hostCapabilities()` to `startingFidelity` and `mpvArgs`. Add one case to `create-player.test.ts`. With a wiring whose `hdrSignalling` resolves `"swapchain-formats"`, `play` gives `startPlayback` deps with `hdrSignalling: "swapchain-formats"` (`startPlayback.mock.calls[0]?.[2]`). The engine tests in Step 1 already prove that this value gives the `yes` hint.

- [ ] **Step 6: Verify**

Run: `mise run check`. Expected: PASS. At the wave gate, the integrator runs `mise run e2e`. `player.hdr.spec.ts` runs under KWin with `auto`.

- [ ] **Step 7: Commit**

`fix(picture): pick the HDR colorspace hint from how the compositor signals HDR`

---

### Task 9: An output smaller than the picture is a reported downgrade (#20)

**Files:**

- Modify: `packages/fidelity/src/picture.ts` (the `scalePlan` body), `engine.ts` (the `learn` `outputSize` branch)
- Modify: `packages/fidelity/src/scenarios.ts`, `docs/fidelity/compatibility.md` (regenerated)
- Already frozen by wave 0: `model.ts`, `index.ts`, the place of `scalePlan` in `fidelityView`, and the `scaledDown` member of the IPC schema in `shared/bridge.ts` (05, C2 and C4)
- Modify: `apps/desktop/src/main/player/fidelity-watch.ts` (`sample`)
- Test: `packages/fidelity/src/engine.test.ts`, `apps/desktop/src/main/player/fidelity-watch.test.ts`

**Interfaces:**

- Consumes: the `PictureWorld` and `FidelityStart` from wave 0.
- Produces (the types are frozen; the behaviour is this task's):

```ts
// model.ts
export interface Size { readonly width: number; readonly height: number }
Observation += { readonly kind: "outputSize"; readonly output: Size; readonly picture: Size }
DowngradeReason += { readonly kind: "scaledDown"; readonly output: Size }
// picture.ts
PictureWorld += readonly scaled: { readonly picture: Size; readonly output: Size } | null   // startFidelity sets null
export const scalePlan = (picture: PictureSource | null, world: PictureWorld): Downgrade | null
// downgrade when picture !== null && scaled !== null:
//   { leg: "picture", from: "3840×2160", to: "1920×1080", reason: { kind: "scaledDown", output },
//     message: "Scaled down to 1920×1080 by the output." }
```

- `learn` handles `outputSize`. It sets `scaled` to `{ picture, output }` when `picture.width > output.width || picture.height > output.height`, and to `null` otherwise.
- `fidelityView` puts `scalePlan(...)` straight after `picture.downgrade` in `downgrades`.
- The watcher reads `osd-dimensions` (`{ w, h }`) and `video-params` (`{ dw, dh }`) in the same sample as `video-target-params`, once a VO exists. It calls `learn({ kind: "outputSize", … }, false)` only when all four numbers are > 0 and differ from the last ones sent. A renderer failure resets the last value, as it resets `display`.

- [ ] **Step 1: Write the failing tests**

engine.test.ts:

```ts
it("a 4K picture on a 1080p output is reported as scaled down", () => {
  const { view } = run(
    start({ picture: hdr10 }),
    { kind: "displayTarget", hdr: true },
    {
      kind: "outputSize",
      output: { width: 1920, height: 1080 },
      picture: { width: 3840, height: 2160 },
    }
  );
  expect(view.downgrades).toStrictEqual([
    {
      leg: "picture",
      from: "3840×2160",
      to: "1920×1080",
      reason: { kind: "scaledDown", output: { width: 1920, height: 1080 } },
      message: "Scaled down to 1920×1080 by the output.",
    },
  ]);
});
it("a letterboxed film that fits its output is not scaled down", () => {
  // picture 3840×1608 on output 3840×2160 → downgrades []
});
it("an output that grows back clears the downgrade", () => {
  /* 1920×1080, then 3840×2160 → [] */
});
```

fidelity-watch.test.ts: widen `MpvValue` with `{ readonly w: number; readonly h: number }` and `{ readonly dw: number; readonly dh: number }`.

```ts
it("an output smaller than the picture is reported, and 0×0 before the output is up is not", async () => {
  // props: current-ao, current-vo, video-target-params {gamma:"pq"}, osd-dimensions {w:0,h:0}, video-params {dw:3840,dh:2160}
  // samples(2) → downgrades []
  // osd-dimensions {w:1920,h:1080}; samples(1) → reasons [{kind:"scaledDown", output:{width:1920,height:1080}}]
  // osd-dimensions {w:3840,h:2160}; samples(1) → []
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `scripts/bounded.sh test 3G -- bun x vitest run --maxWorkers=2 packages/fidelity apps/desktop/src/main/player/fidelity-watch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the engine and the watcher, then add the scenario**

New display: `{ name: "4K video on a 1080p output", hdrSignalling: "swapchain-formats", observed: [{ kind: "displayTarget", hdr: true }, { kind: "outputSize", output: { width: 1920, height: 1080 }, picture: { width: 3840, height: 2160 } }] }`.

- [ ] **Step 4: Regenerate and review the table**

Run: `mise run fidelity:table && git diff docs/fidelity/compatibility.md`
Expected diff, and only this:

- one new column, in which every row's fact ends with ` ⬇`
- one Why row per picture, saying `Scaled down to 1920×1080 by the output.`
- a hint-table row `yes`

- [ ] **Step 5: Verify**

Run: `mise run check`. Expected: PASS. At the wave gate, the integrator runs `mise run e2e`. In the e2e window, the output matches the video size, so `player.hdr.spec.ts` shows no new downgrade.

- [ ] **Step 6: Commit**

`feat(picture): report a picture scaled down by the output`

---

## After the release: checks on the HTPC

These need the target. Run them once the updater has installed a release with Tasks 1 to 9:

- [ ] The run log has no ERR line from the updater while the feed is reachable.
- [ ] A TrueHD film shows Dolby TrueHD on the receiver.
- [ ] In Game Mode: sign in, quit, launch again. harakiri opens on the library, and Settings shows "Signed in on this device without a keyring".
- [ ] With Steam's HDR on, an HDR10 film reaches the TV as HDR, and the run log shows `--target-colorspace-hint=yes`. With Steam's HDR off, the player says "The display takes SDR only".
- [ ] The run log's `Display 0 (gamescope)` line tells whether films are scaled down. If they are, the player says "Scaled down to 1920×1080 by the output."
