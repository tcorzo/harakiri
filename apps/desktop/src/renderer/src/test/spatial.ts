import {
  destroy,
  GetBoundingClientRectAdapter,
  init,
  setKeyMap,
  updateAllLayouts,
} from "@noriginmedia/norigin-spatial-navigation";

/** Starts norigin the way main.tsx does: DOM focus follows it, and it handles no keys itself. */
export function startSpatial(): void {
  init({ layoutAdapter: GetBoundingClientRectAdapter, shouldFocusDOMNode: true });
  setKeyMap({ left: [], up: [], right: [], down: [], enter: [] });
}

export function stopSpatial(): void {
  destroy();
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** happy-dom lays nothing out, so each node a test navigates over gets the box it would have on screen. */
export function place(node: Element, box: Box): void {
  Object.defineProperty(node, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      ...box,
      left: box.x,
      top: box.y,
      right: box.x + box.width,
      bottom: box.y + box.height,
    }),
  });
}

/** norigin measures on registration and re-measures only stale layouts, so placed boxes are re-read here. */
export async function remeasure(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
  void updateAllLayouts();
}
