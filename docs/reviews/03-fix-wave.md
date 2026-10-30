# Review 03: the review 02 fix wave (368e684..83c34d3)

Two adversarial reviewers read the diff: Reviewer A on Opus, Reviewer B on Fable. Neither ran anything. Findings both raised independently are marked **A+B**.

## Intent

The commits fix the renderer bugs from review 02 and add `player.prepare`, so the handoff states the server's decision. They send `stopped` before the stop report, share one client identity, revoke the token on sign out, and add the UI end-to-end specs.

## Act on

1. **A transcode URL's token reaches the log and the screen (B, critical).** `MpvCommandError` and `MpvTimeoutError` quote the whole command in their message. A failed `loadfile` of a `TranscodingUrl` (which carries `api_key`) or a timed-out `sub-add` (which carries `ApiKey`) puts the token in `logger.error` and in the `error` event the handoff prints. Redact inside the mpv client's error construction with `redactSecrets`, so no caller can forget. Add a test that forces a failing `loadfile` with a token URL and asserts the token is in neither the log nor the event.
2. **The prepare cache ignores the session (A+B).** `requestKey` leaves out the server, the user and the token, and sign out never clears `pending`. A play within 60 s of a sign out reuses the revoked token. `takePrepared` also clears `pending` before comparing keys, so a queued play discards a newer prepare. Key on the session too, clear on `sessionClear` and `sessionSave`, and compare before clearing. Cover expiry and a failed prepare in `index.test.ts`.
3. **Errors are still misclassified (A+B).**
   - Only 401 means signed out. Jellyfin answers 403 for policy denials with a valid token, and "Sign in again" then revokes a good token.
   - Everything that is not a `ServerStatusError` reads as "did not answer", including zod and TypeErrors. Classify network failures alone as unreachable, and add an unexpected kind that shows the message.
   - Main throws a plain `Error`, and IPC wraps it as "Error invoking remote method…". Move `ServerStatusError` to `src/shared`, throw it from both interceptors, carry the status across IPC, and route a 401 found by `prepare` to the signed-out flow.
   - On the signed-out path, `forgetSession` should not post a logout with a dead token.
4. **The title page refetches before the server stores the stop (A).** The renderer invalidates on `stopped`, which now arrives before the stop report. Signal when the report settles (for example, `stop()` and the `done` path resolve after it), and invalidate then.
5. **"Unreadable" is set on direct plays (A).** `unreadable` ignores the play method. Set it only when the server transcodes and has no streams.
6. **After `ended`, the screen claims mpv is still playing (B).** The station stays on Picture, the copy says "Press Back to stop", and Back does nothing while the next-episode query is pending. Add an ended state; Back there leaves.
7. **The handoff waits on a cosmetic request (B).** `preparePlayback` awaits `getItem` alongside PlaybackInfo, so a slow or failed item fetch delays or fails the slug. Resolve PlaybackInfo alone, and fetch the overlay title separately with a fallback.
8. **Flaky-by-construction e2e (A+B).**
   - The 800 ms settle test runs on a flowing fake clock. Use `pauseAt` and `runFor`.
   - "B between Picture and mpv" races mpv start. Hold the window open deterministically.
   - The revocation assertion needs a positive control: the same request returns 200 before sign out.
   - The hold-Down test filters out a null focus, so lost focus passes.
   - The `< 60 s` assertion cannot fail apart from the timeout.
9. **Stale text and identity in e2e (A+B).** The `revokeAppDevice` comment and D16 still say sign out is local. D16's rule must also cover `forgetSession` from the error screen. The e2e worker signs in as `Harakiri` / `harakiri-e2e` on the app's device id; use `clientIdentity`.
10. **Hero cycle edge cases (A+B).** The resumed index points into a random list that is refetched after 5 minutes of gc; remember the film id. An early `tick` stops the cycle until the next press. `getCurrentFocusKey()` can be null in the Up guard.
11. **Dead and duplicated surface (A+B).** The `appVersion` channel has no caller. `signalPathFor` is test-only, and `PlayerEvent` carries both `facts` and `signalPath`; keep only one if the overlay allows. `SignalFact` is defined twice, so derive the zod enum from one source. `SignalReport` defaults hide main regressions. The hub calls `keyToAction` twice per repeat. `Prepared.request` is unused.
12. **Space on the on-screen keyboard types a space (A).** Elsewhere Space is Select.

## Noted

Nothing beyond the above. Both reviewers confirmed that every IPC handler checks its sender, `prepare` and `play` parse their payloads, `stop` serialises behind `play`, and no path puts a token in mpv's argv.

## Agreement map

Both reviewers found the prepare-cache key, the error classification, the two racy e2e tests, and the stale sign-out text. Reviewer B alone found the token in mpv error messages; it is the most serious finding and is cheap to prove with a test. Reviewer A alone found the stale-resume refetch and the unreadable-on-direct-play label.
