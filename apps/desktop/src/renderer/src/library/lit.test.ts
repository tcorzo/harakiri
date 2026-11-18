import { expect, test, vi } from "vitest";

import { cardKey, restoreKeys, rowKey, travelMs, useLit } from "./lit";

test("focus keys name the section and the entry, never their positions", () => {
  expect(cardKey("genre:Drama", "a1")).toBe("card|genre:Drama|a1");
  expect(rowKey("resume")).toBe("row|resume");
});

test("returning tries the remembered card, then its row, then the hero, then the first row", () => {
  expect(restoreKeys({ section: "next-up", entry: "e7" }, true, "resume")).toEqual([
    "card|next-up|e7",
    "row|next-up",
    "hero-play",
    "row|resume",
  ]);
  expect(restoreKeys(null, false, "latest")).toEqual(["row|latest"]);
  expect(restoreKeys(null, false, undefined)).toEqual([]);
});

test("a second section change within a held repeat travels; a rested move glides", () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  useLit.getState().forget();
  const { enter } = useLit.getState();
  enter({ id: "resume", name: "Continue Watching" });
  expect(useLit.getState().travelling).toBe(false);
  vi.setSystemTime(10_000 + 400);
  enter({ id: "next-up", name: "Next Up" });
  expect(useLit.getState().travelling).toBe(true);
  vi.setSystemTime(10_000 + 400 + travelMs);
  enter({ id: "latest", name: "Recently Added" });
  expect(useLit.getState().travelling).toBe(false);
  useLit.getState().forget();
  vi.useRealTimers();
});
