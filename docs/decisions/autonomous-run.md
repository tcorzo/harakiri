# Autonomous run: decision trail

Started 2026-10-30 after the owner went to sleep with the instruction to run fully autonomous until harakiri has (1) a working first-boot onboarding (Jellyfin server, login, user, land on content), (2) a library gallery with a scrolling hero, (3) a fully functioning player. Constraints from the owner: follow vercel-react-best-practices, route all web UI through the impeccable loop (critique, audit), build strong end-to-end and validation harnesses for complex interactions, and run periodic adversarial reviews (interrogate) of UI design, architecture and agent work.

Each entry: the decision, why, and what the owner could tell me to do instead.

## D1. Visual direction taken unattended

The impeccable direction round normally waits for the owner's pick on a decision page. The owner was asleep and had said to proceed autonomously, so the roll's assigned direction was taken without a page round (impeccable's rule: infer from the brief once the user tells you to proceed).

Grounded candidates, ordered by resonance (from the cinephile owner's world, not the tools they operate):

1. ECM / hi-fi record sleeve: vast quiet ground, small precise type, the photograph leads.
2. Criterion Collection editions: spine numbers, editorial type, one art direction per title.
3. **Film festival programme catalogue** (Venice, Cannes, NYFF screening guides): every film an entry with programme notes; technical facts set as screening notes.
4. Repertory cinema lightbox marquee.
5. The darkening auditorium (house lights down, curtain).
6. 1960s Japanese film poster, vertical type (the literal reading of the name; capped at one).
7. Projection booth reel labels (the operator's tool; capped at one).

The seed assigned candidate 3 (seed key 1ac23202, mode experience). It fits the product unusually well: fidelity facts read as programme notes ("4K · Dolby Vision · TrueHD Atmos 7.1 · 133 min"), which answers the owner's "fidelity visible, never spec-sheet nerdy" and "a sort of Tidal".

Challengers, fused and weighed on audience identification and product clarity. All declined; each donated one discipline:

- Miura-fold sheet (declined). Raise: one press moves the whole field. Focus change re-lights hero, colour and notes as one linked system.
- Cephalopod chromatophore skin (declined). Raise: a state vocabulary for signal. Each fidelity note has states: native (passed as-is), mapped (Dolby Vision applied, delivered as HDR10), decoded (PCM).
- Algorave source floor (declined). Raise: upcoming change is visible before it happens. The hero shows what is next; the play handoff states the signal path before the picture starts.
- Darkroom safelight bay (declined). Raise: fixed stations in order, timed emergence. The screening handoff is a fixed sequence (house dims, programme slug, picture) with deliberate timing.
- Creator hardware bench (declined). Raise: one reserved accent for the action that matters. A single accent colour exists only for Play / Resume.
- Doujin event catalog (declined). Raise: every entry carries a catalogue code. Each title has a programme number; watched titles are marked like a festival-goer's annotated guide.

Instead: the owner can re-run the round (`impeccable concept-seed --scope direction --mode experience --from 1ac23202 --reroll 1`) or name another candidate above; the world is recorded in `apps/desktop/DESIGN.md` and swapping it is a token and component pass, not a rewrite.

Image generation is not available in this harness, so the build is code-led.

## D2. Transcode fallback stays enabled, and is announced

`playbackInfoRequest` sends `EnableTranscoding: true` so a server that refuses direct play still plays something. PRODUCT.md principle 1 says never transcode silently, so the UI must show a plain "The server is converting this file" notice with the reasons whenever PlaybackInfo returns a `TranscodingUrl`.
Instead: a strict mode that sends `EnableTranscoding: false` and refuses to play.

## D3. SDK-level response validation stays off

Generated zod schemas are exported and used explicitly at the few boundaries that matter (session, PlaybackInfo). Validating every response risks breaking on real server data the spec does not describe.
Instead: turn on hey-api's `validator` for all responses.

## D4. mpv is isolated from the user's mpv.conf for playback

Playback spawns mpv with `--config-dir` pointing at an app-owned directory, so a personal `mpv.conf` cannot silently change the HDR or passthrough path the harness validates. A user `mpv.conf` hook can come later as an explicit setting.
Instead: honour `~/.config/mpv/mpv.conf`.

## D5. Resource bounds: a capped systemd slice plus a watchdog

The owner asked that memory-hungry runs be bounded and watched. The machine had 25 of 31 GB in use (mostly the owner's own Firefox and a long-running bun daemon, neither touched). Every heavy harakiri process now runs in its own scope under `harakiri.slice` (slice cap 7 GB, throttled from 6 GB, no swap) through `scripts/bounded.sh`. A kernel cap was proven by letting a 600 MB allocation die in a 200 MB scope (exit 137). `scripts/watchdog.sh` runs as a session monitor and stops the largest harakiri scope when MemAvailable drops under 1.5 GB or full memory pressure reaches 25%.
Instead: raise the caps with `HARAKIRI_SLICE_MAX` and `HARAKIRI_SLICE_HIGH`, or the watchdog thresholds with `WATCHDOG_FLOOR_MB` and `WATCHDOG_PSI_FULL`.

## D6. Dev Jellyfin capped at 3 GB, and the watchdog covers it

At 2 GB the dev Jellyfin thrashed during the library scan (its ffprobe runs with `-probesize 1G`), pushing system-wide full memory pressure to 34-50%. Raising the container cap to 3 GB dropped it to 2% within 20 seconds. The watchdog now reports container memory, prints only on state changes, and restarts the container once when it is the largest harakiri consumer under pressure. The owner's swap was already full (40 of 40 GB) before the run; nothing outside harakiri was touched.
Instead: keep 2 GB and lower Jellyfin's scan concurrency only.

## D7. Main-process session and IPC choices (wave 2, main-services owner)

- Player events go to the window that asked to play (`event.sender`), because no Electron window has focus while mpv is fullscreen.
- The token is stored as a tagged union, `{kind:"encrypted", base64}` or `{kind:"plain", value}`. Plain storage is allowed only when `HARAKIRI_E2E=1`. Files are written with mode 0600.
- Without a keyring outside e2e, the session lives in memory only and any old `session.json` is deleted.
- The device id lives in its own `device-id` file, so signing out keeps the same Jellyfin device.
- LogTape is configured in main with a console sink at info level.
  Instead: store the token in plain text everywhere (simpler, weaker), or tie the device id to the session.

## D8. Programme notes and library data (wave 2, data-layer owner)

- A note describes the best audio track (object audio first, then channels, then format), not the server's default track. One HDR10 movie's default is a Russian AC3 stereo dub; its note says TrueHD Atmos 7.1.
- SDR is written out ("1080p SDR"), so a bare "4K" never reads as HDR.
- The Dolby Vision profile number stays out of the note. Profile 7 with an enhancement layer reads "Dolby Vision (base layer)".
- LPCM counts as native delivery, because it passes as it is.
- Programme sections are built from genres on the client, because `/Genres` returned nothing during the scan and the dev library has no collections.
- Recently Added asks for movies and series, because episodes otherwise consume the limit before grouping.
- The hero and sections are random once per app session, then stable.
- The data-layer owner refreshed metadata on seven dev-server items whose streams were not yet probed.
  Instead: describe the default track, drop "SDR", show the DV profile number, or count LPCM as decoded.

## D9. Input while typing and across the player switch (review 01 fix)

- While a text field has focus, ArrowLeft and ArrowRight move the caret, and Space and Backspace type. ArrowUp, ArrowDown, Enter, Escape, and the remote keys still act, so the d-pad can leave a field.
- Every pad button held when the input mode switches stays silent until it is released, including held directions.
- The stick enters a direction at 0.5 and leaves it below 0.35.
- TEXTAREA is treated as single-line, so ArrowUp and ArrowDown leave it. The app has no multi-line fields.
  Instead: let arrows always navigate (fields would need an explicit exit), or treat TEXTAREA as multi-line.

## D10. Player behaviour (wave 2, player owner)

- The Authorization header uses the session's device id, because the token belongs to the device that signed in. Identity: Client "Harakiri", Device set to the hostname, Version set to the app version.
- `play()` resolves once mpv has loaded the file. A failed load sends an `error` event, then rejects.
- When the renderer does not choose tracks, mpv follows the server's default audio and subtitle streams, which carry the user's Jellyfin preferences.
- Controls appear on every action. They stay while paused or while the track menu is open, and hide after 4 s otherwise. The track menu is one list: audio tracks, then subtitles starting with "Off".
- The overlay uses the renderer's colour tokens, Noto Sans with horizontal scaling for condensed and wide styles, and the reserved accent only on the play/pause glyph.
- A server transcode reads "Server transcode" with the reasons beside it, because the output format is not known up front.
- The integration test restores the item's original resume position afterwards.
  Instead: use the per-install device id, keep the overlay visible while playing, or resolve `play()` only when playback ends.

## D11. mpv timeouts and secrets (review 01 fix)

- Any mpv IPC request that exceeds its deadline (10 s by default, per spawn) SIGKILLs mpv, and the player ends playback with `error`. Several call sites swallow errors, so the policy lives in the client.
- The harness capture runs with `--no-config` through the same builder the player uses; its argv is the shipped argv plus three capture flags.
- A sidecar subtitle that fails to load is logged (without its URL, which carries `ApiKey`) and skipped. Later sidecar ids shift; mapping by `external-filename` would remove that limitation.
- The start report is skipped when playback already finished while sidecars loaded, to avoid a ghost session.
  Instead: per-request timeouts chosen at each call site.

## D12. Window security and lifecycle (review 01 fix)

- The app keeps loading from file://. The CSP is set as a response header, which Electron 45 applies to file:// pages (proven with an inline-script probe). No custom `app://` scheme.
- Packaged CSP: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' http: https: data: blob:; font-src 'self' data:; connect-src 'self' http: https:`. The dev server variant adds `'unsafe-inline'` scripts and `ws:` for Vite.
- Navigation, new windows and webviews are denied outside the app origin. Every IPC handler rejects foreign senders.
- The device id lives only in the `device-id` file; main injects it into every session and exposes it through `window.harakiri.deviceId()`.
- Quit is held up to 5 s while the player stops; a failed stop still exits. On process exit, a live mpv is SIGKILLed. Stale mpv socket dirs older than 60 s are removed at startup. A second launch focuses the first window.
- Workspace packages are bundled into the main process (they ship raw TypeScript); `@harakiri/jellyfin` declares `sideEffects: false` to keep the preload small.
  Instead: a custom `app://` protocol with a privileged scheme.

## D13. Real-server contract tier is opt-in

`mise run test:contract` (the `*.contract.test.ts` tier in `vitest.tiers.config.ts`) proves, against a real Jellyfin serving the generated corpus (`packages/harness/src/corpus/catalog.ts`), that every catalog entry direct plays under harakiri's profile with the audio the catalog declares, that Jellyfin Desktop's DOVI condition transcodes the DV profile 5 episode with `VideoRangeTypeNotSupported`, that dropping `MaxStreamingBitrate` (Jellyfin then assumes 8 Mbps) transcodes the 14 Mbps `sdr-h264-lpcm-bitrate` entry with `ContainerBitrateExceedsLimit`, and that the whole library, exactly the catalog's size, direct plays. Pointed at any other server through `JELLYFIN_DEV_URL`, `_USER` and `_PASSWORD`, the same file checks one item per stream class, picks the controls by criteria (a DV profile 5 item, the highest-bitrate item) and reports every item that would not direct play, without a count. The live tier follows the same rule: exact, catalog-derived assertions on the corpus, invariants that hold for any library elsewhere. Nothing is skipped. It stays out of `mise run test` and the push hook because it needs a server.
Instead: put the tier in the default run; or keep anchoring it on the owner's library (rejected: nothing committed may depend on it).

## D14. Renderer design and behaviour (wave 3, UI lead)

The direction contract (`apps/desktop/.impeccable/surfaces/src-renderer.md`, festival programme catalogue) was turned into these concrete calls. `apps/desktop/DESIGN.md` records the resulting system; its names "The Screening Programme", "Saffron Play" and "Section Blue" are the documenter's proposals and wait for the owner.

- Type is Archivo Variable (`@fontsource-variable/archivo`), self-hosted so the CSP stays `font-src 'self'`.
- The palette is an oklch blue-black ink. Saffron marks only Play and Resume. The ultramarine band marks sections only.
- Catalogue numbers ("No. 074") follow date added, so a title keeps its number while the library only grows. Removing a title renumbers every title added after it (review 02); storing numbers is not worth it for one user.
- The hero advances after 20 s idle, ignores Play for 800 ms after the film changes so a late press never starts the wrong film, and never auto-advances under reduced motion.
- Onboarding is a reducer state machine with an on-screen d-pad keyboard. The minimum server version is 10.10.
- Rows relight their backdrop 180 ms after focus settles, so fast d-pad travel does not thrash images. The section scroll does not wait for it (review 02).
- The screening handoff runs House (1200 ms), then Programme (3000 ms), then Picture; Back cancels at any step.
- The app version comes from `apps/desktop/package.json`, injected at build time (`HARAKIRI_APP_VERSION`), because unpackaged Electron reports its own version from `app.getVersion()` and Electron 45 has no `app.setVersion`.
- Review screenshots in `apps/desktop/e2e/screenshots/` are not committed: they show the owner's library artwork and weigh 11 MB.
  Instead: a system font stack, a saffron accent across all focus states, a fixed hero cadence.

## D15. Review 02 fix wave (renderer owner)

- **The handoff states the server's decision.** Main resolves PlaybackInfo during the House station (`player.prepare`) and returns `{facts, transcodeReasons, unreadable}`; the Programme station starts once the house has dimmed and the server has answered, and `player.play` reuses that resolution for up to 60 s.
  Instead: keep the renderer's own classification as the slug and only correct it once mpv starts.
- **A file the server could not read is still handed to mpv.** The slug says "The server could not read this file" in place of the transcode reasons, and playback is attempted; if it fails, the failure screen says why.
  Instead: stop at the handoff and refuse to play.
- **One client identity, "harakiri" on "harakiri desktop".** Built in `src/shared/identity.ts` with the build-time version in every bundle. The player no longer sends the hostname as the device name.
  Instead: send the hostname from both sides, which needs a bridge call before the first request.
- **A revoked sign-in explains itself.** A 401 or 403 shows "Signed out by the server" with "Sign in again" focused, which keeps the server; it does not redirect silently.
  Instead: redirect straight to the user list.
- **A failed programme section becomes its own row** with "Try again"; the hero and the other rows still show. Rows wait until every request settles, so they never shift under focus.
  Instead: an error boundary per row that renders as each request lands.
- **After an episode ends, the next one is offered, not started.** The handoff screen shows "Next" with Play focused and "Back to the series". After a film from the library hero, the player returns to its title page (PRD player acceptance); from a title page it returns there.
  Instead: auto-play the next episode after a countdown.
- **Native facts carry no mark.** Only mapped and decoded facts show their mark and word, in the programme notes and on the slug.
- **Physical typing on the on-screen keyboard.** A key with focus takes Backspace and printable characters into the field, so Backspace never leaves the step.
- **Screen containers force focus.** A press with nothing focused recovers to the screen instead of doing nothing, and every programmatic focus goes through `focusFirst`, which never hands norigin an unregistered key.

## D16. End-to-end UI tests, part 2 (e2e owner)

- `HARAKIRI_DISCOVERY_ADDRESS` (an IPv4, read in `main/env.ts`) aims the discovery probe at one host instead of 255.255.255.255. The e2e points it at 127.0.0.1, where the rootless container answers unicast, or at 127.0.0.2 for an empty network. It also keeps a LAN Jellyfin out of the run.
  Instead: a `--discovery-address` argument, or skipping discovery in e2e.
- Tests for a known bug are written against the intended behaviour and marked `test.fixme` with the review item, so they turn on after the fix wave. New bugs found by the e2e are marked the same way, with "new:".
- The dev server hides its only user, so the public-users shortcut is tested with `page.route` serving that one real user; the sign-in after it is real. Servers the dev Jellyfin cannot be (404 page, router page, another product, 10.9, a server refusing sign-in) are a local HTTP stub (`e2e/support/stub.ts`).
  Instead: flipping the user's `IsHidden` policy on the server for the test.
- A profile that signed in through the UI has its device deleted on the server at teardown. Settings' Sign out and Change server, and the error screen's Change server, revoke the token on the server themselves (`forgetSession` with `revoke`), but a test can end still signed in, or leave through the error screen's Sign in again, which never resends a token the server refused (401). Seeded profiles share the worker's device and never sign in or sign out through the UI: a UI sign-in on that device id replaces the worker's token, and any of those sign-outs, including `forgetSession` from the error screen, revokes it.
- The worker signs in with the app's own identity (`clientIdentity` plus the app's package version) on its fresh device id, so a seeded app and the worker show the server one client on that device.
- The hero cycle is driven with Playwright's clock (`clock.install` and a reload, then `fastForward`), not 20 s waits.
- Continue Watching is made deterministic by giving the shortest SDR item a resume point played now; its user data is restored at teardown.
  Instead: depend on whatever the owner last watched.

## D17. Review 03 fix wave

- **mpv errors carry the command name only.** `MpvCommandError` and `MpvTimeoutError` keep the verb (`loadfile`, `sub-add`) and drop every argument at construction, and a pending request never holds its arguments. Stream URLs, sidecar URLs and the Authorization header therefore cannot reach a message, a field, a log or a `PlayerEvent`, whatever the caller does. `setHttpHeaders` no longer rewraps errors.
  Instead: keep the arguments and run them through `redactSecrets`, which only catches the token shapes its regex knows (it misses `MediaBrowser Token="…"`), or keep the property name for `*_property` commands, which is useful but is still a caller-supplied string.
- **`reported` is the last player event.** `ended`, `stopped` and `error` still arrive as soon as mpv quits, so the screen comes back at once; `reported` follows when the stop report has settled (stored or failed). The renderer refetches the played item's queries on `reported`, through a listener that outlives the screening screen. `stop()` and `done` already resolved after the report.
  Instead: a separate IPC channel for the report, or invalidating again after a fixed delay.
- **The prepare cache is keyed on the session too** (server, user, device id, token, then the request), is dropped on `session:clear` and `session:save`, and a play for another request leaves a newer prepare in place.
  Instead: key on a session generation counter bumped by every save and clear.
- **Error kinds.** 401 is signed out; 403 is a new `refused` kind ("The server refused this", Try again or Change server); only ky's `NetworkError`/`TimeoutError`, a `TimeoutError` DOMException and Chromium's raw "Failed to fetch" are unreachable; anything else is `unexpected` ("Something did not work") and shows its message. `ServerStatusError` lives in `src/shared/errors.ts`, both clients throw it, and the preload rebuilds it from Electron's wrapped IPC message (`fromIpc`), which also strips Electron's "Error invoking remote method" prefix from every bridge error. A 401 from `prepare` or `play` throws into the route's error screen. Sign in again forgets the session without posting a logout; Change server still revokes, best effort.
  Instead: return a result union from the `prepare` handler instead of throwing across IPC.
- **The handoff resolves on PlaybackInfo alone.** The item fetch for the overlay's title runs beside it with a 3 s cap; on failure or timeout the overlay and `--force-media-title` use the media source's name, or "Untitled". mpv starts once the title is known or given up on.
  Instead: start mpv without waiting and set `force-media-title` over IPC when the title lands.
- **"Unreadable" only on a transcode** with no video or audio stream information; a direct play never needs it.
- **After `ended` the screen says "Played to the end. Press Back to leave."** while the next episode is looked up, and Back leaves to where the screening was started. The station rule stays on Picture.
  Instead: a fourth station.
- **`PlayerEvent` carries `facts` only.** `signalPath` is gone from the event (the overlay builds its own line in main); tests join the facts with `joinFacts` from `@harakiri/jellyfin`, where the signal states are defined once and the bridge's zod enum is derived from them. `SignalReport` has no defaults, so main dropping a field fails the bridge parse. The `appVersion` channel, `signalPathFor` and `Prepared.request` are gone.
- **The hero is remembered by film id**, so a refetched (reshuffled) featured list resumes the same film; an early hero timer re-arms instead of stopping the cycle.
- **Space on a focused on-screen key is Select**, as everywhere else: it presses the key and types no space.
- **Deterministic e2e.** The 800 ms settle test pauses the page clock and moves it only with `runFor`. "B between Picture and mpv" runs mpv with `e2e/support/hold-load.lua`, which defers mpv's `on_load` hook until the test writes `release` into the app's mpv config dir. The onboarding minute test gets a 120 s timeout so its `< 60 s` assertion can fail on its own.
  Instead: delay the stream in the dev Jellyfin, which the test cannot reach.

## D18. An address typed without a scheme tries HTTPS first

The owner's public Jellyfin server (an HTTPS domain such as `https://jellyfin.example.com`, behind a reverse proxy) failed onboarding: a bare host became `http://host:8096/`, and a server behind a reverse proxy answers only HTTPS on 443. `serverCandidates` now turns an address without a scheme into `https://host/` and `http://host:8096/` (or both schemes on a typed port). `checkServer` checks them at once, and the first that answers as a supported Jellyfin wins. When none does, a problem from a candidate that answered beats "unreachable". A typed scheme is taken as is.

Alternative: keep one URL and tell the owner to type `https://`. Rejected because typing `https://` on a d-pad keyboard costs eight extra key presses.

## D19. Passthrough follows the output, and every run writes a log

The owner heard nothing from a DV profile 5 episode (E-AC3 5.1) on the workstation. mpv sent the bitstream to a USB audio interface, an analog sink that lists only `pcm`. mpv's PipeWire output reported that it opened, then failed with "no target node available" and never fell back to decoding. `readOutputPassthrough` now reads the default sink's formats with `pactl --format=json` before each play and passes only the codecs it lists. A sink it cannot read gets decoding, with a warning.

Nothing recorded the failure. mpv writes its log to stdout off a terminal, and `spawnMpv` read only stderr, which main dropped below `info`. mpv's stdout and stderr now go to the log at `--msg-level=all=v`. `redactSecrets` also covers the `Token="…"` that verbose mpv echoes from the Authorization header. `openRunLog` writes each run's log synchronously, so a crash keeps its last lines.

The verbose run also showed mpv's ytdl hook starting `yt-dlp` with an `api_key=` URL in its argv after a failed load. `buildPlaybackArgs` now passes `--ytdl=no`.

Alternatives:

- Keep passthrough unconditional and let the owner pick a sink. Rejected: the default is silence on any non-HDMI output.
- Write mpv's own `--log-file`. Rejected: it cannot be redacted, and it would hold the token.

On the TV box, passthrough needs the HDMI sink's codecs enabled in PipeWire, for example the passthrough checkboxes in pavucontrol. Without them, a bitstream was silent before this change too.

## D20. Playback steps down instead of failing, decided by a pure engine

The owner asked for reliable playback: each leg aims for its best quality and falls to a lower playable one, with the how and why reported for the UI. They also asked for it to be encapsulated, fully testable, and able to produce a compatibility and downgrade table.

- `packages/fidelity` holds the decisions as pure functions. Its state records facts about the world (the output broke, the renderer rung, what the display took). The plan, the signal facts and the downgrades are derived from that state, so `observe` updates the world, derives again, and returns the actions from the difference. It has no dependency on mpv, Electron or Jellyfin.
- `scenarios.ts` simulates outputs, displays, GPUs and deliveries as the observations mpv would report on each. `table.ts` renders `docs/fidelity/compatibility.md` from them, and a test keeps the committed file equal to the engine's output.
- The desktop adapter has three parts. `fidelity-input.ts` maps Jellyfin data to the engine's sources, reading a transcode's output from its TranscodingUrl: a stream is copied when its codec is listed and no reason touches it, and otherwise encoded to the first listed codec. `audio-output.ts` reads pactl. `fidelity-watch.ts` samples mpv every 500 ms and applies actions.
- Detection was measured on real mpv, not assumed:
  - With video keeping the clock, a dead PipeWire bitstream leaves `current-ao` present about half the time, so `ao/` warnings mark a sample as failing.
  - A missing video output is a failure only with a `vo/` error, because `--vid=no` has none either.
  - `vid=auto` does not reselect a track mid-file, so the watcher selects video by id.
  - With both outputs dead, mpv raced 8 s of content in 1 s, so a step-down seeks back to the last healthy moment.
- `SignalReport` and `PlayerEvent` carry `downgrades`, and the facts now come from the engine, so they say what actually plays. Before this, they repeated Jellyfin's metadata even when mpv decoded or played silence. `resolve.ts` no longer builds facts.
- e2e describes its audio output with `HARAKIRI_AUDIO_OUTPUT` instead of forcing `--audio-spdif` behind the engine's back.

Not built: a final rung that asks the server to transcode when mpv cannot open the file at all. It needs a second PlaybackInfo request with direct play off and a restart of mpv. A server transcode is also what broke fidelity in the first place, so when to allow it is the owner's call.

Alternatives:

- Fallback logic inside `playback.ts`. Rejected: it cannot produce the table, and it couples the decisions to mpv.
- Per-leg packages. Rejected: the legs share the delivery and one view of the facts.

## D21. The corpus replaces the census fixtures

`packages/harness/src/fixtures.ts` (18 paths into the owner's library) is gone. The contract and live tiers take their items from the corpus catalog, the one table of what the synthetic library holds, and `corpus/coverage.test.ts` keeps the old invariant that every passthrough codec and HDR signalling case the corpus can build is present. DOVIInvalid, DV 7 dual-PID m2ts, DV 8.1 at 1080p and Hi10P are not built yet, so only an opt-in run against a real library covers them.

Instead: keep a fixture list of real files. Rejected: it ships the owner's library and needs the NAS.

## D22. e2e runs against a fake Jellyfin on the corpus

The owner's rule is that nothing committed may depend on a running third-party service or the owner's library. All 49 e2e tests used to sign in to the dev Jellyfin at worker setup. Each Playwright worker now starts `startFakeJellyfin` from `packages/harness/src/fake-jellyfin` on 127.0.0.1:0.

- Its items come from the corpus catalog and `corpus.json`. Its MediaStreams come from ffprobe and the catalog's verified classification.
- Its state lives in memory per instance and is reset after every test, so the suite no longer saves and restores user data. Any unknown route or invalid body fails the test.
- It answers discovery on 127.0.0.3, so it never collides with a dev container on 127.0.0.1:7359.
- globalSetup generates the corpus. `mise run e2e` fetches the FATE samples first, and without them the TrueHD Atmos test fails naming `mise run media:fetch-fate`.
- `HARAKIRI_E2E_SERVER` keeps the real-server path.
- A contract-tier conformance test (`fake.contract.test.ts`) holds the fake to a real 12.4 server on the same corpus.

The corpus now loops FATE audio to the item's length, because `atmos.thd` holds 0.1 s.

Instead: (a) MSW. Rejected: mpv fetches the stream and subtitles itself, outside any in-process interceptor. (b) The real container for every e2e run. Rejected for the default tier: it needs podman and a 751 MB image, and is slower; it stays the contract tier. (c) A fake generated from the OpenAPI types. Rejected: the spec's shapes do not match what 12.4 sends (Open items).

## Open items found during the run

- **E-AC3 tail burst (harness T1).** mpv 0.41 with `--ao=pcm` writes every E-AC3 burst byte-identically except the last one when the source is MKV (192 kHz IEC 61937). The raw `.eac3` file loses nothing. The test pins the one-burst gap exactly. Cause unknown; likely mpv's end-of-stream handling. It affects only the final ~32 ms of a file, not passthrough correctness mid-stream.
- **TrueHD tail (harness T0).** FFmpeg's spdif muxer never flushes the last partial MAT frame, so the reference itself is a prefix. Not an mpv issue.
- **Generated zod schemas do not match real server data.** They type `Size` and `RunTimeTicks` as bigint and `BaseItemDto.Id` as a dashed UUID, while Jellyfin 12.4 sends numbers and undashed ids. That supports D3 (no SDK-wide response validation). Fix upstream in the hey-api config or hand-write the few boundary schemas that matter.
- **Player fixtures contain the owner's library paths.** `apps/desktop/src/main/player/fixtures/*.json` and `packages/jellyfin/src/__fixtures__/` keep real file names and NAS paths (API keys redacted). Fine for a private repo; strip `Path` in the recorders before the repo is ever made public.
- **One 2160p season is unreadable on the NAS.** Its files return `Permission denied` to the owner's user, so Jellyfin cannot probe it and transcodes it. Owner action: fix the share ACL, then rescan (`mise exec -- bun dev/jellyfin/bootstrap.ts --scan`).
- **Unprobed items should be explained, not just transcoded.** Done in the review 02 fix wave (D15): the handoff and the player say "The server could not read this file" instead of a transcode.
- **Renderer chunk is 845 kB.** TanStack Router splits routes, but one chunk still carries most of the app. Split before packaging; it costs startup time on low-end TV boxes.
- **States not yet seen on screen:** series page, Quick Connect, public user tiles, track picker, transcode notice, failed screening, the seen mark, reduced motion, voice credits.
- **`holding Down keeps the focused card on screen` fails against the current dev Jellyfin.** It fails on c3e259b as well, so no recent change caused it. The focused Continue Watching card (now led by a different series) is off screen for a few samples at the start of the hold.
