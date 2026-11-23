/**
 * Dev only: harakiri's additions to impeccable's live widget. A grip drags the global bar anywhere
 * on screen, and a toggle shows or hides the outline impeccable draws around the picked element.
 * Both are remembered per browser. A focus guard keeps impeccable's steer box from taking the
 * d-pad's focus away from the app. The dev server loads this only while the helper runs
 * (apps/desktop/dev/impeccable-live.ts); nothing here is in any build.
 *
 * impeccable draws its chrome inside the shadow root of #impeccable-live-root (or in the document
 * on older helpers). It may rebuild the bar, so the controls are put back whenever they go missing.
 */

const prefix = "impeccable-live";

const ids = {
  root: `${prefix}-root`,
  bar: `${prefix}-global-bar`,
  highlight: `${prefix}-highlight`,
  steer: `${prefix}-page-chat-input`,
  grip: "harakiri-live-grip",
  outline: "harakiri-live-outline",
  style: "harakiri-live-style",
} as const;

const offsetKey = "harakiri.live.offset";
const outlineKey = "harakiri.live.outline";

export interface Offset {
  readonly x: number;
  readonly y: number;
}

/** Storage can be missing or throw (private windows, cleared site data); the chrome works without it. */
const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; nothing else depends on it.
  }
};

export const savedOffset = (): Offset => {
  const [x, y] = (read(offsetKey) ?? "").split(",").map(Number);

  return Number.isFinite(x) && Number.isFinite(y) ? { x: x ?? 0, y: y ?? 0 } : { x: 0, y: 0 };
};

const find = (root: ParentNode, id: string): HTMLElement | null => {
  const found = root.querySelector(`#${id}`);

  return found instanceof HTMLElement ? found : null;
};

/** Where impeccable mounts its chrome: its shadow root, or the document itself. */
const chromeRoot = (doc: Document): ShadowRoot | Document | null => {
  const host = find(doc, ids.root);

  if (host?.shadowRoot) {
    return host.shadowRoot;
  }

  return find(doc, ids.bar) === null ? null : doc;
};

/** The element the drag and outline state sit on, so the stylesheet can read them. */
const stateHost = (root: ShadowRoot | Document): HTMLElement | null => {
  if (root instanceof ShadowRoot) {
    return root.host instanceof HTMLElement ? root.host : null;
  }

  return root.documentElement;
};

const css = (root: ShadowRoot | Document): string => {
  const hidden =
    root instanceof ShadowRoot
      ? ':host([data-harakiri-outline="hidden"])'
      : 'html[data-harakiri-outline="hidden"]';

  return `
    #${ids.bar} { translate: var(--harakiri-live-x, 0px) var(--harakiri-live-y, 0px); }
    ${hidden} #${ids.highlight} { visibility: hidden !important; }
    #${ids.grip}, #${ids.outline} {
      all: unset; box-sizing: border-box; display: inline-flex; align-items: center;
      justify-content: center; width: 28px; align-self: stretch; color: inherit; opacity: 0.7;
    }
    #${ids.grip} { cursor: grab; touch-action: none; }
    #${ids.grip}:active { cursor: grabbing; }
    #${ids.outline} { cursor: pointer; }
    #${ids.outline} .slash { display: none; }
    #${ids.outline}[aria-pressed="false"] { opacity: 0.85; }
    #${ids.outline}[aria-pressed="false"] .slash { display: inline; }
    #${ids.grip}:hover, #${ids.outline}:hover, #${ids.grip}:focus-visible, #${ids.outline}:focus-visible { opacity: 1; }
    #${ids.grip} svg, #${ids.outline} svg { width: 14px; height: 14px; }
  `;
};

const gripIcon =
  '<svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><circle cx="5" cy="3" r="1.2"/><circle cx="9" cy="3" r="1.2"/><circle cx="5" cy="7" r="1.2"/><circle cx="9" cy="7" r="1.2"/><circle cx="5" cy="11" r="1.2"/><circle cx="9" cy="11" r="1.2"/></svg>';

/** A dashed frame for the outline; a slash crosses it out while the outline is hidden. */
const outlineIcon =
  '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="1.5" y="1.5" width="11" height="11" stroke-dasharray="2.2 1.6"/><line class="slash" x1="1" y1="13" x2="13" y2="1" stroke-width="1.6"/></svg>';

const applyOffset = (host: HTMLElement, offset: Offset): void => {
  host.style.setProperty("--harakiri-live-x", `${offset.x}px`);
  host.style.setProperty("--harakiri-live-y", `${offset.y}px`);
};

const applyOutline = (host: HTMLElement, toggle: HTMLElement | null, shown: boolean): void => {
  host.dataset.harakiriOutline = shown ? "shown" : "hidden";
  toggle?.setAttribute("aria-pressed", String(shown));
  toggle?.setAttribute(
    "title",
    shown ? "Hide the selection outline" : "Show the selection outline"
  );
};

const makeGrip = (doc: Document, bar: HTMLElement, host: HTMLElement): HTMLButtonElement => {
  const grip = doc.createElement("button");
  grip.id = ids.grip;
  grip.type = "button";
  grip.title = "Drag to move; double-click to put it back";
  grip.setAttribute("aria-label", "Move the live bar");
  grip.innerHTML = gripIcon;

  let offset = savedOffset();
  let start: { pointer: Offset; offset: Offset; rect: DOMRect } | null = null;

  grip.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    start = {
      pointer: { x: event.clientX, y: event.clientY },
      offset,
      rect: bar.getBoundingClientRect(),
    };

    try {
      grip.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer has no capture; moves still reach the grip.
    }
  });

  grip.addEventListener("pointermove", (event) => {
    if (start === null) {
      return;
    }

    const view = doc.defaultView;
    const width = view?.innerWidth ?? Number.POSITIVE_INFINITY;
    const height = view?.innerHeight ?? Number.POSITIVE_INFINITY;

    // Keep the whole bar on screen, however far the pointer goes.
    const dx = Math.min(
      Math.max(event.clientX - start.pointer.x, -start.rect.left),
      width - start.rect.right
    );

    const dy = Math.min(
      Math.max(event.clientY - start.pointer.y, -start.rect.top),
      height - start.rect.bottom
    );

    offset = { x: start.offset.x + dx, y: start.offset.y + dy };
    applyOffset(host, offset);
  });

  const end = (): void => {
    if (start !== null) {
      start = null;
      write(offsetKey, `${offset.x},${offset.y}`);
    }
  };

  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  grip.addEventListener("dblclick", () => {
    offset = { x: 0, y: 0 };
    applyOffset(host, offset);
    write(offsetKey, "0,0");
  });

  return grip;
};

const makeOutlineToggle = (doc: Document, host: HTMLElement): HTMLButtonElement => {
  const toggle = doc.createElement("button");
  toggle.id = ids.outline;
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Selection outline");
  toggle.innerHTML = outlineIcon;
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const shown = host.dataset.harakiriOutline === "hidden";
    applyOutline(host, toggle, shown);
    write(outlineKey, shown ? "shown" : "hidden");
  });

  return toggle;
};

/** Adds the stylesheet and both controls to impeccable's chrome; false while it is not there yet. */
export const enhanceLiveChrome = (doc: Document): boolean => {
  const root = chromeRoot(doc);
  const bar = root === null ? null : find(root, ids.bar);
  const host = root === null ? null : stateHost(root);

  if (root === null || bar === null || host === null) {
    return false;
  }

  if (find(root, ids.style) === null) {
    const style = doc.createElement("style");
    style.id = ids.style;
    style.textContent = css(root);
    (root instanceof ShadowRoot ? root : doc.head).append(style);
    applyOffset(host, savedOffset());
    applyOutline(host, null, read(outlineKey) !== "hidden");
  }

  if (find(root, ids.grip) === null) {
    bar.prepend(makeGrip(doc, bar, host));
  }

  if (find(root, ids.outline) === null) {
    const toggle = makeOutlineToggle(doc, host);
    bar.append(toggle);
    applyOutline(host, toggle, host.dataset.harakiriOutline !== "hidden");
  }

  return true;
};

/** How long after a press on impeccable's chrome a focus there counts as the user's own. */
const chosenFocusMs = 1000;

const inChrome = (node: EventTarget | null): boolean =>
  node instanceof Element && node.closest(`[id^="${prefix}"]`) !== null;

/**
 * impeccable focuses its steer box whenever the page loads or the box loses focus, which suits a
 * mouse page but starves a d-pad app: the arrows type into the box and no card keeps the focus ring.
 * When the box takes focus without a press on impeccable's chrome just before, this hands focus back
 * to the app and sends the mousedown impeccable reads as "the page is in use", which pauses its
 * auto-focus until the next real click. Returns a function that stops guarding.
 */
export const guardAppFocus = (doc: Document): (() => void) => {
  let pressedChromeAt = Number.NEGATIVE_INFINITY;

  const onPointerDown = (event: Event): void => {
    if (inChrome(event.composedPath()[0] ?? null)) {
      pressedChromeAt = performance.now();
    }
  };

  const onFocusIn = (event: FocusEvent): void => {
    const [target] = event.composedPath();

    if (!(target instanceof HTMLElement) || target.id !== ids.steer) {
      return;
    }

    if (performance.now() - pressedChromeAt < chosenFocusMs) {
      return;
    }

    doc.documentElement.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const previous = event.relatedTarget;

    if (previous instanceof HTMLElement && !inChrome(previous)) {
      previous.focus({ preventScroll: true });
    } else {
      target.blur();
    }
  };

  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("focusin", onFocusIn, true);

  return () => {
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("focusin", onFocusIn, true);
  };
};

/**
 * Waits for impeccable's chrome, enhances it, and puts the controls back whenever impeccable
 * rebuilds its bar. Returns a function that stops watching.
 */
export const watchLiveChrome = (doc: Document): (() => void) => {
  let watching: Node | null = null;

  const rootObserver = new MutationObserver(() => {
    enhanceLiveChrome(doc);
  });

  // Both callbacks run only after this function returns, so each can name the other.
  const docObserver = new MutationObserver(() => {
    attach();
  });

  const attach = (): void => {
    const root = chromeRoot(doc);

    if (!enhanceLiveChrome(doc) || root === null || root === watching) {
      return;
    }

    watching = root;
    rootObserver.observe(root, { childList: true, subtree: true });
    // From here only impeccable's own root can lose the controls.
    docObserver.disconnect();
  };

  docObserver.observe(doc.documentElement, { childList: true, subtree: true });
  attach();

  return () => {
    docObserver.disconnect();
    rootObserver.disconnect();
  };
};
