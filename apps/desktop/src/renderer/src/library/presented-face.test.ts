import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toEntry } from "../data/entry";
import { faceOutMs, faceReadyCapMs, usePresentedFace } from "./presented-face";
import type { Face } from "./presented-face";

const hero = toEntry({ Id: "0123456789abcdef0123456789abcdef", Name: "Hero", Type: "Movie" });
const card = toEntry({ Id: "fedcba9876543210fedcba9876543210", Name: "Card", Type: "Movie" });

const render = (initial: Face | null, prepare?: (face: Face) => Promise<void>) =>
  renderHook(({ target }: { target: Face | null }) => usePresentedFace(target, prepare), {
    initialProps: { target: initial },
  });

const seen = (result: { current: ReturnType<typeof usePresentedFace> }) => [
  result.current.face?.entry.title ?? null,
  result.current.face?.staged ?? null,
  result.current.visible,
];

describe("the block over the stage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves before it changes entry, then returns with the new one", async () => {
    const { result, rerender } = render({ entry: hero, staged: false });

    rerender({ target: { entry: card, staged: false } });
    expect(seen(result)).toStrictEqual(["Hero", false, false]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(faceOutMs);
    });
    expect(seen(result)).toStrictEqual(["Card", false, true]);
  });

  it("leaves before the hero gives up the stage, even with the same entry", async () => {
    const { result, rerender } = render({ entry: hero, staged: true });

    rerender({ target: { entry: hero, staged: false } });
    expect(seen(result)).toStrictEqual(["Hero", true, false]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(faceOutMs);
    });
    expect(seen(result)).toStrictEqual(["Hero", false, true]);
  });

  it("stays out while nothing is lit, and the next entry comes straight back", async () => {
    const { result, rerender } = render({ entry: hero, staged: true });

    rerender({ target: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(faceOutMs);
    });
    expect(seen(result)).toStrictEqual([null, null, false]);

    rerender({ target: { entry: card, staged: false } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen(result)).toStrictEqual(["Card", false, true]);
  });

  it("shows fresher data for the same face at once", () => {
    const { result, rerender } = render({ entry: card, staged: false });
    const full = { ...card, overview: "The full title landed." };

    rerender({ target: { entry: full, staged: false } });
    expect(result.current.face?.entry.overview).toBe("The full title landed.");
    expect(result.current.visible).toBe(true);
  });

  it("comes back unchanged when the face it was leaving returns", async () => {
    const { result, rerender } = render({ entry: hero, staged: true });

    rerender({ target: { entry: hero, staged: false } });
    rerender({ target: { entry: hero, staged: true } });
    expect(seen(result)).toStrictEqual(["Hero", true, true]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(faceOutMs);
    });
    expect(seen(result)).toStrictEqual(["Hero", true, true]);
  });

  it("waits for the new title to be ready before it returns, but never past the cap", async () => {
    const logo = Promise.withResolvers<boolean>();

    const { result, rerender } = render({ entry: hero, staged: true }, async () => {
      await logo.promise;
    });

    rerender({ target: { entry: card, staged: false } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(faceOutMs);
    });
    expect(seen(result)).toStrictEqual(["Card", false, false]);

    await act(async () => {
      logo.resolve(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen(result)).toStrictEqual(["Card", false, true]);

    rerender({ target: { entry: hero, staged: true } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(faceOutMs + faceReadyCapMs);
    });
    expect(seen(result)).toStrictEqual(["Hero", true, true]);
  });

  it("leaves with the fresher data it last showed", async () => {
    const { result, rerender } = render({ entry: card, staged: false });
    const full = { ...card, overview: "The full title landed." };

    rerender({ target: { entry: full, staged: false } });
    rerender({ target: { entry: hero, staged: true } });
    expect(result.current.visible).toBe(false);
    expect(result.current.face?.entry.overview).toBe("The full title landed.");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(faceOutMs);
    });
    expect(seen(result)).toStrictEqual(["Hero", true, true]);
  });
});
