// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { MenuRow } from "./controls";
import { renderControls } from "./overlay";
import type { ControlsView } from "./overlay";

const playing: ControlsView = {
  title: "Fixture Film",
  programme: "2001 · 2 h 5 min · R",
  signalPath: "Dolby Vision mapped to HDR10 · TrueHD Atmos bitstream",
  transcodeReasons: [],
  downgraded: false,
  positionSeconds: 3725,
  durationSeconds: 7486,
  paused: false,
  menu: null,
};

const rows: MenuRow[] = [
  { property: "aid", id: 1, label: "Japanese - Dolby TrueHD + Dolby Atmos - 7.1" },
  { property: "aid", id: 2, label: "English - TRUEHD - 5.1" },
  { property: "sid", id: false, label: "Off" },
  { property: "sid", id: 1, label: "English - PGSSUB" },
  { property: "sid", id: 2, label: "(Foreign) - English - Forced - PGSSUB" },
];

describe("controls overlay", () => {
  it("playing: title, programme, signal path, scrub bar at half, paper play glyph on the red tile", () => {
    expect(renderControls(playing)).toMatchInlineSnapshot(`
    "{\\an7\\pos(0,560)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&HE0&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,570)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&HD4&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,580)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&HC8&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,590)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&HBC&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,600)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&HB0&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,610)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&HA4&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,620)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H98&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,630)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H8C&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,640)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H80&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,650)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H74&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,660)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H68&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,670)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H5C&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,680)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H50&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,690)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H44&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,700)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H30&\\p1}m 0 0 l 1920 0 1920 380 0 380{\\p0}
    {\\an7\\pos(96,728)\\bord0\\shad0\\blur0\\fnNoto Sans\\b1\\fs24\\fscx84\\fsp4\\1c&HB3BCC5&}NOW SCREENING
    {\\an7\\pos(96,756)\\bord0\\shad0\\blur0\\fnNoto Sans\\b1\\fs84\\fscx118\\1c&HE9F0F3&}Fixture Film
    {\\an7\\pos(96,850)\\bord0\\shad0\\blur0\\fnNoto Sans\\b0\\fs34\\fscx84\\1c&HB3BCC5&}2001 · 2 h 5 min · R
    {\\an7\\pos(96,894)\\bord0\\shad0\\blur0\\fnNoto Sans\\b0\\fs34\\fscx84\\1c&HE9F0F3&}Dolby Vision mapped to HDR10 · TrueHD Atmos bitstream
    {\\an7\\pos(96,968)\\bord0\\shad0\\blur0\\1c&HB3BCC5&\\1a&H60&\\p1}m 0 0 l 1728 0 1728 2 0 2{\\p0}
    {\\an7\\pos(96,966)\\bord0\\shad0\\blur0\\1c&HE9F0F3&\\1a&H00&\\p1}m 0 0 l 860 0 860 6 0 6{\\p0}
    {\\an7\\pos(954,954)\\bord0\\shad0\\blur0\\1c&HE9F0F3&\\1a&H00&\\p1}m 0 0 l 4 0 4 30 0 30{\\p0}
    {\\an7\\pos(94,982)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H00&\\p1}m 0 0 l 48 0 48 48 0 48{\\p0}
    {\\an7\\pos(96,984)\\bord0\\shad0\\blur0\\1c&H1B0F9B&\\1a&H00&\\p1}m 0 0 l 44 0 44 44 0 44{\\p0}
    {\\an7\\pos(108,992)\\bord0\\shad0\\blur0\\1c&HE9F0F3&\\1a&H00&\\p1}m 0 0 l 24 14 0 28{\\p0}
    {\\an7\\pos(160,988)\\bord0\\shad0\\blur0\\fnNoto Sans\\b1\\fs34\\fscx84\\1c&HE9F0F3&}1:02:05
    {\\an9\\pos(1824,988)\\bord0\\shad0\\blur0\\fnNoto Sans\\b0\\fs34\\fscx84\\1c&HB3BCC5&}2:04:46"
  `);
  });

  it("paused under a server transcode: an amber square leads the fact line and its reasons", () => {
    expect(
      renderControls({
        ...playing,
        paused: true,
        signalPath: "Server transcode",
        transcodeReasons: ["Bitrate over the limit", "Too many audio channels"],
        positionSeconds: 59,
        durationSeconds: 1421,
      })
    ).toMatchInlineSnapshot(`
    "{\\an7\\pos(0,560)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&HE0&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,570)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&HD4&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,580)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&HC8&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,590)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&HBC&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,600)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&HB0&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,610)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&HA4&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,620)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H98&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,630)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H8C&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,640)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H80&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,650)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H74&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,660)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H68&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,670)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H5C&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,680)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H50&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,690)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H44&\\p1}m 0 0 l 1920 0 1920 10 0 10{\\p0}
    {\\an7\\pos(0,700)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H30&\\p1}m 0 0 l 1920 0 1920 380 0 380{\\p0}
    {\\an7\\pos(96,728)\\bord0\\shad0\\blur0\\fnNoto Sans\\b1\\fs24\\fscx84\\fsp4\\1c&HB3BCC5&}PAUSED
    {\\an7\\pos(96,756)\\bord0\\shad0\\blur0\\fnNoto Sans\\b1\\fs84\\fscx118\\1c&HE9F0F3&}Fixture Film
    {\\an7\\pos(96,850)\\bord0\\shad0\\blur0\\fnNoto Sans\\b0\\fs34\\fscx84\\1c&HB3BCC5&}2001 · 2 h 5 min · R
    {\\an7\\pos(96,902)\\bord0\\shad0\\blur0\\1c&H43C2F7&\\1a&H00&\\p1}m 0 0 l 18 0 18 18 0 18{\\p0}
    {\\an7\\pos(130,894)\\bord0\\shad0\\blur0\\fnNoto Sans\\b0\\fs34\\fscx84\\1c&HE9F0F3&}Server transcode · Bitrate over the limit · Too many audio channels
    {\\an7\\pos(96,968)\\bord0\\shad0\\blur0\\1c&HB3BCC5&\\1a&H60&\\p1}m 0 0 l 1728 0 1728 2 0 2{\\p0}
    {\\an7\\pos(96,966)\\bord0\\shad0\\blur0\\1c&HE9F0F3&\\1a&H00&\\p1}m 0 0 l 72 0 72 6 0 6{\\p0}
    {\\an7\\pos(166,954)\\bord0\\shad0\\blur0\\1c&HE9F0F3&\\1a&H00&\\p1}m 0 0 l 4 0 4 30 0 30{\\p0}
    {\\an7\\pos(94,982)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H00&\\p1}m 0 0 l 48 0 48 48 0 48{\\p0}
    {\\an7\\pos(96,984)\\bord0\\shad0\\blur0\\1c&H1B0F9B&\\1a&H00&\\p1}m 0 0 l 44 0 44 44 0 44{\\p0}
    {\\an7\\pos(106,992)\\bord0\\shad0\\blur0\\1c&HE9F0F3&\\1a&H00&\\p1}m 0 0 l 8 0 8 28 0 28 m 16 0 l 24 0 24 28 16 28{\\p0}
    {\\an7\\pos(160,988)\\bord0\\shad0\\blur0\\fnNoto Sans\\b1\\fs34\\fscx84\\1c&HE9F0F3&}0:59
    {\\an9\\pos(1824,988)\\bord0\\shad0\\blur0\\fnNoto Sans\\b0\\fs34\\fscx84\\1c&HB3BCC5&}23:41"
  `);
  });

  it("a downgrade leads the fact line with the amber square; a native play has none", () => {
    const lines = renderControls({ ...playing, downgraded: true }).split("\n");

    const fact = lines.findIndex((line) =>
      line.endsWith("Dolby Vision mapped to HDR10 · TrueHD Atmos bitstream")
    );

    expect(lines[fact - 1]).toBe(
      "{\\an7\\pos(96,902)\\bord0\\shad0\\blur0\\1c&H43C2F7&\\1a&H00&\\p1}m 0 0 l 18 0 18 18 0 18{\\p0}"
    );
    expect(lines[fact]).toContain("\\pos(130,894)");
    expect(renderControls(playing)).not.toContain("&H43C2F7&");
  });

  it("track menu: sections, the focused row, and the tracks in use", () => {
    const ass = renderControls({ ...playing, menu: { rows, cursor: 3, aid: 1, sid: false } });
    expect(ass.split("\n").slice(-13)).toMatchInlineSnapshot(`
    [
      "{\\an7\\pos(1248,100)\\bord0\\shad0\\blur0\\1c&H05060A&\\1a&H28&\\p1}m 0 0 l 576 0 576 430 0 430{\\p0}",
      "{\\an7\\pos(1280,140)\\bord0\\shad0\\blur0\\fnNoto Sans\\b1\\fs24\\fscx84\\fsp4\\1c&HB3BCC5&}SOUND",
      "{\\an7\\pos(1280,176)\\bord0\\shad0\\blur0\\1c&HB3BCC5&\\1a&H60&\\p1}m 0 0 l 512 0 512 1 0 1{\\p0}",
      "{\\an7\\pos(1300,188)\\bord0\\shad0\\blur0\\fnNoto Sans\\b0\\fs32\\fscx84\\1c&HB3BCC5&}Japanese - Dolby TrueHD + Dolby Atmos - 7.1",
      "{\\an7\\pos(1776,205)\\bord0\\shad0\\blur0\\1c&HE9F0F3&\\1a&H00&\\p1}m 0 0 l 10 0 10 10 0 10{\\p0}",
      "{\\an7\\pos(1300,236)\\bord0\\shad0\\blur0\\fnNoto Sans\\b0\\fs32\\fscx84\\1c&HB3BCC5&}English - TRUEHD - 5.1",
      "{\\an7\\pos(1280,298)\\bord0\\shad0\\blur0\\fnNoto Sans\\b1\\fs24\\fscx84\\fsp4\\1c&HB3BCC5&}SUBTITLES",
      "{\\an7\\pos(1280,334)\\bord0\\shad0\\blur0\\1c&HB3BCC5&\\1a&H60&\\p1}m 0 0 l 512 0 512 1 0 1{\\p0}",
      "{\\an7\\pos(1300,346)\\bord0\\shad0\\blur0\\fnNoto Sans\\b0\\fs32\\fscx84\\1c&HB3BCC5&}Off",
      "{\\an7\\pos(1776,363)\\bord0\\shad0\\blur0\\1c&HE9F0F3&\\1a&H00&\\p1}m 0 0 l 10 0 10 10 0 10{\\p0}",
      "{\\an7\\pos(1280,398)\\bord0\\shad0\\blur0\\1c&HE9F0F3&\\1a&H00&\\p1}m 0 0 l 4 0 4 38 0 38{\\p0}",
      "{\\an7\\pos(1300,394)\\bord0\\shad0\\blur0\\fnNoto Sans\\b1\\fs32\\fscx84\\1c&HE9F0F3&}English - PGSSUB",
      "{\\an7\\pos(1300,442)\\bord0\\shad0\\blur0\\fnNoto Sans\\b0\\fs32\\fscx84\\1c&HB3BCC5&}(Foreign) - English - Forced - PGSSUB",
    ]
  `);
  });

  it("a long subtitle list scrolls so the cursor stays in a nine-row window", () => {
    const many: MenuRow[] = Array.from({ length: 30 }, (_, i) => ({
      property: "sid",
      id: i + 1,
      label: `Subtitle ${i + 1}`,
    }));

    const ass = renderControls({ ...playing, menu: { rows: many, cursor: 20, aid: 1, sid: 21 } });
    const labels = [...ass.matchAll(/\}(?<label>Subtitle \d+)$/gmu)].map((m) => m.groups?.label);
    expect(labels).toStrictEqual([
      "Subtitle 17",
      "Subtitle 18",
      "Subtitle 19",
      "Subtitle 20",
      "Subtitle 21",
      "Subtitle 22",
      "Subtitle 23",
      "Subtitle 24",
      "Subtitle 25",
    ]);
  });

  it("item text cannot open an override block or form an escape", () => {
    const ass = renderControls({ ...playing, title: "Who {\\b0}Framed\\N Roger" });
    expect(ass).toContain("}Who \\{\\⁠b0\\}Framed\\⁠N Roger\n");
  });
});
