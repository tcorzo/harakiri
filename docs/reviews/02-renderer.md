# Review 02: renderer (commit 4a454f1)

Two adversarial reviewers read the renderer, the direction contract, and the screenshots of the running app: Reviewer A on Opus, Reviewer B on Fable. Neither ran the app. Findings both raised independently are marked **A+B**.

## Intent

Commit 4a454f1 adds the TV-first, gamepad-first renderer. It covers onboarding, a library led by a cycling hero, title and series pages, and the screening handoff into mpv. It must be fully d-pad navigable, honour the festival programme catalogue direction, and respect the input guard.

## Act on

1. **The on-screen keyboard traps focus (A+B).** `ui/keyboard.tsx` sets `isFocusBoundary` with no directions, and norigin then blocks every direction. The discovered servers, "Search again", and the entry field cannot be reached by d-pad. `DiscoveredList` also steals focus when discovery resolves mid-typing. Physical Backspace on a key leaves the step.
2. **Hero Play is dropped after any press (A+B).** `heroCycle.ts` gates Play on the last input, not on the last film change. Gate on a `changedAt` set only when the index changes.
3. **The d-pad goes dead on unregistered focus keys (A+B).** `EmptyLibrary` is chosen when the hero pool is empty, even when rows have data. It then focuses `hero-play`, which never mounts. `place` restore is positional, so a shifted row leaves focus on a missing key. Key `place` by section id and entry id, and render rows even when the hero is empty.
4. **Leaving a screening reshuffles the library (A+B).** `ScreeningScreen.tsx` invalidates the whole library root. The random hero changes under a stable index, and the full catalogue downloads again. Invalidate only the played item, resume, and next-up.
5. **Invisible controls stay focusable (A+B).** In row mode, the hero actions and "Next screening" are opacity 0 but still focusable. Up from row 1 skips the hero, and Right from a short row lands on an invisible button. Use `focusable: holding` and handle Up from row 1 explicitly.
6. **Per-fact badges read as a spec sheet (A+B).** "NATIVE ■" on every plain title and "□ DECODED" on lossless audio break the contract. Mark only `mapped` and `decoded`, and leave native facts bare.
7. **Two client identities for one device id (A+B).** The renderer sends `harakiri` / `harakiri desktop` / a hard-coded `0.1.0`; the player sends `Harakiri` / hostname / `appVersion()`. Build the identity once in `src/shared`, with the version injected into both bundles.
8. **One wrong error message for every failure (A+B).** A 401 reads "The server did not answer". One failing row replaces the whole library. `changeServer` keeps the old server's lit state. Send 401 and 403 to sign-in with the server kept, give rows their own error boundary, and forget lit state on server change.
9. **The handoff guesses the signal path (B).** The slug shows the renderer's own classification of the first MediaSource. The server's decision, including transcode reasons, arrives about 1 s before mpv covers the screen. The PRD requires the handoff to state transcode reasons. Resolve PlaybackInfo during House through a `player.prepare` step, and send structured facts (`{text, state}[]`) instead of a string that the renderer splits and index-aligns.
10. **Holding the d-pad does not scroll (A).** The vertical offset follows the 180 ms debounced relight, and gamepad repeat is 120 ms. Move the section immediately and debounce only the backdrop.
11. **The gamepad is dead around the mpv window (A).** `setMode("player")` runs before mpv exists, and after mpv quits main awaits the stop report before sending `stopped`. Enter player mode once mpv has the file, and send `stopped` before the report.
12. **Keyboard auto-repeat fires Select and Back (A).** `input/hub.ts` does not filter `event.repeat`. Remotes repeat on long presses.
13. **The series page loses its place (A).** `initialSeason` is never passed. `title-play` mounts only after episodes load. `keepPreviousData` lets Play start the previous season.
14. **Playback end differs from the PRD (B).** After an episode ends nothing is offered, and quitting from hero Play returns to the library instead of the title page. `stop()` rejection on Back is unhandled.
15. **TV-box performance (A+B).** Every card focus prefetches the full item with no debounce. `remPx()` calls `getComputedStyle` per card per render, and `ProgrammeRow` re-renders on every store change.
16. **Small fixes.** "No. 083" wraps in the slug (A+B). The hero restarts at film 0 on every return (A). A wrong password remounts the keyboard (A). "Settings" contrast over bright backdrops (A). Select acts on `document.activeElement`, not norigin's focus (A). Rows keyed by name (B). `kindOf` defaults unknown types to Movie (B). Dead code: `formatClock`, `Entry.genres`, `ActionProps.disabled` (B). The handler-stack comment says "innermost wins" when the code means last-mounted (A).

## Consider

- **Catalogue numbers are not stable** (A+B). They are positions in date-added order, so a deletion renumbers later titles. D14's claim is corrected to "stable while the library only grows"; storing numbers is not worth it for one user.
- **The section label shows twice when a row is lit** (B). The margin band and the row header both say "Continue Watching". Left to the impeccable critique.

## Noted

- StrictMode re-runs sign-in effects in dev and orphans a token (B). Dev only.
- `history.back()` does nothing on a cold start into a deep hash (B). The app always starts at `/`.

## Dismissed

None. Neither reviewer found a token leak in the renderer. Image URLs carry no ApiKey and the renderer logs nothing.

## Agreement map

The reviewers agreed on the eight structural problems: focus traps, the Play gate, dead focus keys, invalidation, invisible focusables, spec-sheet badges, the split identity, and error handling. Both traced the focus problems to the same norigin behaviour, where an unregistered `focusKey` aborts `smartNavigate`. Reviewer A found the timing problems: repeat, debounce, and the mpv mode switch. Reviewer B found the PRD gaps: the handoff signal path and the end-of-playback behaviour.
