import type { MenuRow } from "./controls";

/** The overlay's coordinate space, sent as osd-overlay res_x/res_y. */
export const OVERLAY_WIDTH = 1920;
export const OVERLAY_HEIGHT = 1080;

export interface ControlsView {
  readonly title: string;
  readonly programme: string;
  readonly signalPath: string;
  readonly transcodeReasons: readonly string[];
  /** The fidelity engine stepped below the best this output can take (bitstream to PCM, and so on). */
  readonly downgraded: boolean;
  readonly positionSeconds: number;
  readonly durationSeconds: number | undefined;
  readonly paused: boolean;
  readonly menu: {
    readonly rows: readonly MenuRow[];
    readonly cursor: number;
    readonly aid: number | false | undefined;
    readonly sid: number | false | undefined;
  } | null;
}

// The renderer's tokens in ASS's &HBBGGRR& order: paper (#f3f0e9), dim paper for notes
// (#c5bcb3), programme ink (#0a0605), Harakiri Red (#9b0f1b), the one accent, and Torch Amber
// (#f7c243), the problem mark.
const PAPER = "&HE9F0F3&";
const NOTE = "&HB3BCC5&";
const INK = "&H05060A&";
const ACCENT = "&H1B0F9B&";
const ALERT = "&H43C2F7&";
const FONT = "Noto Sans";

// Overscan-safe margins: 5% of each axis.
const LEFT = 96;
const RIGHT = OVERLAY_WIDTH - 96;
const MENU_LEFT = 1248;
const MENU_ROWS = 9;

// One family set like a catalogue: wide and heavy for titles, condensed for notes.
const STYLE = {
  label: `\\fn${FONT}\\b1\\fs24\\fscx84\\fsp4\\1c${NOTE}`,
  title: `\\fn${FONT}\\b1\\fs84\\fscx118\\1c${PAPER}`,
  note: `\\fn${FONT}\\b0\\fs34\\fscx84\\1c${NOTE}`,
  fact: `\\fn${FONT}\\b0\\fs34\\fscx84\\1c${PAPER}`,
  time: `\\fn${FONT}\\b1\\fs34\\fscx84\\1c${PAPER}`,
  row: `\\fn${FONT}\\b0\\fs32\\fscx84\\1c${NOTE}`,
  rowFocused: `\\fn${FONT}\\b1\\fs32\\fscx84\\1c${PAPER}`,
} as const;

const BASE = "\\bord0\\shad0\\blur0";
const ALERT_MARK = 18;

/** Keeps item titles from opening override blocks or forming `\N`-style escapes. */
const escape = (raw: string): string =>
  raw.replaceAll("\\", "\\⁠").replaceAll("{", "\\{").replaceAll("}", "\\}").replaceAll(/\s+/g, " ");

const text = (x: number, y: number, style: string, content: string, align = 7): string =>
  `{\\an${align}\\pos(${x},${y})${BASE}${style}}${escape(content)}`;

const shape = (x: number, y: number, color: string, alpha: string, path: string): string =>
  `{\\an7\\pos(${x},${y})${BASE}\\1c${color}\\1a${alpha}\\p1}${path}{\\p0}`;

const rect = (x: number, y: number, w: number, h: number, color: string, alpha = "&H00&") =>
  shape(x, y, color, alpha, `m 0 0 l ${w} 0 ${w} ${h} 0 ${h}`);

const clock = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

// The state mark is the Play button in miniature: a red tile with a paper glyph. A red glyph
// alone falls under 2.5:1 against the ink field over a bright frame; paper on red holds 7.4:1.
// An ink keyline keeps the tile's edge over a red frame.
const GLYPH_TILE = 44;
const KEYLINE = 2;
const stateGlyph = (paused: boolean, x: number, y: number): string[] => [
  rect(x - KEYLINE, y - KEYLINE, GLYPH_TILE + 2 * KEYLINE, GLYPH_TILE + 2 * KEYLINE, INK),
  rect(x, y, GLYPH_TILE, GLYPH_TILE, ACCENT),
  paused
    ? shape(x + 10, y + 8, PAPER, "&H00&", "m 0 0 l 8 0 8 28 0 28 m 16 0 l 24 0 24 28 16 28")
    : shape(x + 12, y + 8, PAPER, "&H00&", "m 0 0 l 24 14 0 28"),
];

// libass has no gradient fill, so the ink field fades in over stacked bands.
const FADE = Array.from({ length: 14 }, (_, i) => {
  const alpha = (0xe0 - i * 0x0c).toString(16).toUpperCase().padStart(2, "0");
  return rect(0, 560 + i * 10, OVERLAY_WIDTH, 10, INK, `&H${alpha}&`);
});

const scrub = (view: ControlsView, y: number): string[] => {
  const width = RIGHT - LEFT;
  const fraction =
    view.durationSeconds && view.durationSeconds > 0
      ? Math.min(Math.max(view.positionSeconds / view.durationSeconds, 0), 1)
      : 0;
  const played = Math.round(width * fraction);
  return [
    rect(LEFT, y, width, 2, NOTE, "&H60&"),
    rect(LEFT, y - 2, played, 6, PAPER),
    rect(LEFT + played - 2, y - 14, 4, 30, PAPER),
  ];
};

const menuPanel = (menu: NonNullable<ControlsView["menu"]>): string[] => {
  const { rows, cursor } = menu;
  const start = Math.min(
    Math.max(cursor - Math.floor(MENU_ROWS / 2), 0),
    Math.max(rows.length - MENU_ROWS, 0)
  );
  const visible = rows.slice(start, start + MENU_ROWS);
  const width = RIGHT - MENU_LEFT;
  const events: string[] = [];
  let y = 140;
  visible.forEach((row, offset) => {
    const index = start + offset;
    if (offset === 0 || rows[index - 1]?.property !== row.property) {
      if (offset > 0) y += 14;
      events.push(
        text(MENU_LEFT + 32, y, STYLE.label, row.property === "aid" ? "SOUND" : "SUBTITLES")
      );
      y += 36;
      events.push(rect(MENU_LEFT + 32, y, width - 64, 1, NOTE, "&H60&"));
      y += 12;
    }
    const focused = index === cursor;
    const active = row.id === (row.property === "aid" ? menu.aid : menu.sid);
    if (focused) events.push(rect(MENU_LEFT + 32, y + 4, 4, 38, PAPER));
    events.push(text(MENU_LEFT + 52, y, focused ? STYLE.rowFocused : STYLE.row, row.label));
    if (active) events.push(rect(RIGHT - 48, y + 17, 10, 10, PAPER));
    y += 48;
  });
  return [rect(MENU_LEFT, 100, width, y - 60, INK, "&H28&"), ...events];
};

/** The player controls as ASS events for `osd-overlay` (format ass-events, 1920x1080). */
export function renderControls(view: ControlsView): string {
  const facts = view.transcodeReasons.length
    ? `${view.signalPath} · ${view.transcodeReasons.join(" · ")}`
    : view.signalPath;
  // A transcode or a downgrade is a problem, so its fact line leads with the amber square, sized
  // to the capitals of the 34px line, as the renderer's notices do.
  const problem = view.transcodeReasons.length > 0 || view.downgraded;
  const events = [
    ...FADE,
    rect(0, 700, OVERLAY_WIDTH, OVERLAY_HEIGHT - 700, INK, "&H30&"),
    text(LEFT, 728, STYLE.label, view.paused ? "PAUSED" : "NOW SCREENING"),
    text(LEFT, 756, STYLE.title, view.title),
    text(LEFT, 850, STYLE.note, view.programme),
    ...(problem
      ? [
          rect(LEFT, 902, ALERT_MARK, ALERT_MARK, ALERT),
          text(LEFT + ALERT_MARK + 16, 894, STYLE.fact, facts),
        ]
      : [text(LEFT, 894, STYLE.fact, facts)]),
    ...scrub(view, 968),
    ...stateGlyph(view.paused, LEFT, 984),
    text(LEFT + GLYPH_TILE + 20, 988, STYLE.time, clock(view.positionSeconds)),
    text(RIGHT, 988, STYLE.note, view.durationSeconds ? clock(view.durationSeconds) : "", 9),
    ...(view.menu ? menuPanel(view.menu) : []),
  ];
  return events.join("\n");
}
