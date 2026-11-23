import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { enhanceLiveChrome, savedOffset, watchLiveChrome } from "./live-chrome";

const byId = (root: ParentNode, id: string): HTMLElement => {
  const found = root.querySelector(`#${id}`);

  if (!(found instanceof HTMLElement)) {
    throw new TypeError(`no #${id}`);
  }

  return found;
};

/** A stand-in for impeccable's chrome: a shadow root holding its global bar and selection outline. */
const mountChrome = () => {
  const host = document.createElement("div");
  host.id = "impeccable-live-root";
  const shadow = host.attachShadow({ mode: "open" });
  const bar = document.createElement("div");
  bar.id = "impeccable-live-global-bar";
  Object.assign(bar.style, {
    position: "fixed",
    bottom: "14px",
    left: "100px",
    display: "flex",
    height: "40px",
  });
  bar.append(Object.assign(document.createElement("span"), { textContent: "impeccable" }));
  const highlight = document.createElement("div");
  highlight.id = "impeccable-live-highlight";
  Object.assign(highlight.style, { position: "fixed", width: "50px", height: "50px" });
  shadow.append(bar, highlight);
  document.body.append(host);

  return { shadow, bar, highlight };
};

const unmountChrome = (): void => {
  document.querySelector("#impeccable-live-root")?.remove();
};

const pointer = (type: string, target: Element, x: number, y: number): void => {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0 })
  );
};

const drag = (grip: Element, from: number, to: { x: number; y: number }): void => {
  pointer("pointerdown", grip, from, from);
  pointer("pointermove", grip, to.x, to.y);
  pointer("pointerup", grip, to.x, to.y);
};

const flush = async (): Promise<void> => {
  // oxlint-disable-next-line promise/avoid-new -- setTimeout has no promise form in the DOM lib
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

const ends = (bar: HTMLElement): readonly [string | undefined, string | undefined] => [
  bar.firstElementChild?.id,
  bar.lastElementChild?.id,
];

describe("harakiri's live chrome", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    unmountChrome();
    localStorage.clear();
  });

  it("waits for impeccable's bar, then adds a grip first and an outline toggle last", async () => {
    const stop = watchLiveChrome(document);
    expect(document.querySelector("#harakiri-live-grip")).toBeNull();

    const { shadow, bar } = mountChrome();
    await flush();

    expect(ends(bar)).toStrictEqual(["harakiri-live-grip", "harakiri-live-outline"]);
    expect(byId(shadow, "harakiri-live-outline").getAttribute("aria-pressed")).toBe("true");

    // impeccable rebuilding its bar drops the controls; they come back.
    bar.replaceChildren(Object.assign(document.createElement("span"), { textContent: "rebuilt" }));
    await flush();
    expect(ends(bar)).toStrictEqual(["harakiri-live-grip", "harakiri-live-outline"]);

    stop();
  });

  it("drags the bar with the grip and remembers where it was left", () => {
    const { bar, shadow } = mountChrome();
    expect(enhanceLiveChrome(document)).toBe(true);

    const before = bar.getBoundingClientRect();
    drag(byId(shadow, "harakiri-live-grip"), 10, { x: 210, y: -90 });
    const after = bar.getBoundingClientRect();

    expect([after.left - before.left, after.top - before.top]).toStrictEqual([200, -100]);
    expect(savedOffset()).toStrictEqual({ x: 200, y: -100 });
  });

  it("keeps the bar on screen, and a double-click puts it back", () => {
    const { bar, shadow } = mountChrome();
    enhanceLiveChrome(document);
    const grip = byId(shadow, "harakiri-live-grip");
    const home = bar.getBoundingClientRect();

    // Far past the top-left corner, the bar stops at the edge of the viewport.
    drag(grip, 0, { x: -5000, y: -5000 });
    expect([bar.getBoundingClientRect().left, bar.getBoundingClientRect().top]).toStrictEqual([
      0, 0,
    ]);

    grip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(bar.getBoundingClientRect().left).toBe(home.left);
    expect(savedOffset()).toStrictEqual({ x: 0, y: 0 });
  });

  it("hides and shows the selection outline", () => {
    const { shadow, highlight } = mountChrome();
    enhanceLiveChrome(document);
    const toggle = byId(shadow, "harakiri-live-outline");

    expect(getComputedStyle(highlight).visibility).toBe("visible");

    toggle.click();
    expect(getComputedStyle(highlight).visibility).toBe("hidden");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    toggle.click();
    expect(getComputedStyle(highlight).visibility).toBe("visible");
  });

  it("reads the outline choice back on a fresh page load", () => {
    const first = mountChrome();
    enhanceLiveChrome(document);
    byId(first.shadow, "harakiri-live-outline").click();
    unmountChrome();

    const next = mountChrome();
    enhanceLiveChrome(document);
    expect(getComputedStyle(next.highlight).visibility).toBe("hidden");
    expect(byId(next.shadow, "harakiri-live-outline").getAttribute("aria-pressed")).toBe("false");
  });
});
