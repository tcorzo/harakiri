// @vitest-environment node
import { expect, test } from "vitest";

import { mediaSource } from "./fixtures/load";
import { mpvTrack, trackTable } from "./tracks";

test("direct play numbers embedded tracks per type and appends sidecar subtitles", () => {
  const table = trackTable(mediaSource("dv-hdr10-truehd-atmos"), "DirectPlay", "http://jf.test/");
  expect(table.audio.map(({ index, mpvId }) => [index, mpvId])).toEqual([
    [3, 1],
    [4, 2],
    [5, 3],
    [6, 4],
  ]);
  expect(table.subtitles).toEqual([
    { index: 7, mpvId: 1, label: "English - PGSSUB" },
    { index: 8, mpvId: 2, label: "(Foreign) - English - Forced - PGSSUB" },
    { index: 9, mpvId: 3, label: "Italian - DVDSUB" },
    { index: 10, mpvId: 4, label: "Forced - Italian - Default - SUBRIP" },
    { index: 0, mpvId: 5, label: "English - SUBRIP - External" },
    { index: 1, mpvId: 6, label: "Spanish - SUBRIP - External" },
  ]);
  expect(table.subtitleFiles).toEqual([
    "http://jf.test/Videos/fe56760a-326f-401c-3586-3368589d15f1/fe56760a326f401c35863368589d15f1/Subtitles/0/0/Stream.subrip?ApiKey=REDACTED",
    "http://jf.test/Videos/fe56760a-326f-401c-3586-3368589d15f1/fe56760a326f401c35863368589d15f1/Subtitles/1/0/Stream.subrip?ApiKey=REDACTED",
  ]);
});

test("a transcode carries only the server's audio and every subtitle as a sidecar", () => {
  const table = trackTable(mediaSource("transcode-bitrate"), "Transcode", "http://jf.test/", 4);
  expect(table.audio).toEqual([{ index: 4, mpvId: 1, label: "AAC - 7.1 - Default" }]);
  expect(table.subtitles.map(({ index, mpvId }) => [index, mpvId])).toEqual([
    [0, 1],
    [1, 2],
    [2, 3],
    [5, 4],
    [6, 5],
    [7, 6],
    [8, 7],
  ]);
  expect(table.subtitleFiles[3]).toBe(
    "http://jf.test/Videos/333d2fed-9dc9-bd77-0dfa-6843547d111a/333d2fed9dc9bd770dfa6843547d111a/Subtitles/5/0/Stream.subrip?ApiKey=REDACTED"
  );
});

test("mpvTrack maps a Jellyfin index, turns -1 off, and leaves an unknown choice to mpv", () => {
  const { subtitles } = trackTable(
    mediaSource("dv-hdr10-truehd-atmos"),
    "DirectPlay",
    "http://jf.test/"
  );
  expect(mpvTrack(subtitles, 1)).toBe(6);
  expect(mpvTrack(subtitles, 9)).toBe(3);
  expect(mpvTrack(subtitles, -1)).toBe(false);
  expect(mpvTrack(subtitles, undefined)).toBe(undefined);
  expect(mpvTrack(subtitles, 42)).toBe(undefined);
});
