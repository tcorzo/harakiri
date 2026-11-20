import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { activity, touch } from "../input/activity";
import { heroCycle, heroHoldMs, heroSettleMs, settled, upNext, useHeroCycle } from "./hero-cycle";
import { useLit } from "./lit";

const films = (count: number): string[] => Array.from({ length: count }, (_, i) => `film-${i}`);

const stubReducedMotion = (reduce: boolean): void => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query === "(prefers-reduced-motion: reduce)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
};

describe("hero cycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    activity.setState({ at: 0 });
    useLit.getState().forget();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("the hold is 20 seconds and the tick before it changes nothing", () => {
    const start = { index: 0, since: 0, changedAt: 0 };
    expect(heroCycle(start, { type: "tick", now: 19_999, count: 5, auto: true })).toBe(start);
    expect(heroCycle(start, { type: "tick", now: 20_000, count: 5, auto: true })).toStrictEqual({
      index: 1,
      since: 20_000,
      changedAt: 20_000,
    });
  });

  it("the last film wraps to the first, and Next works even without auto-advance", () => {
    expect(
      heroCycle(
        { index: 4, since: 0, changedAt: 0 },
        { type: "tick", now: 20_000, count: 5, auto: true }
      )
    ).toStrictEqual({
      index: 0,
      since: 20_000,
      changedAt: 20_000,
    });
    expect(
      heroCycle({ index: 2, since: 0, changedAt: 0 }, { type: "next", now: 50, count: 3 })
    ).toStrictEqual({
      index: 0,
      since: 50,
      changedAt: 50,
    });
    expect(
      heroCycle(
        { index: 0, since: 0, changedAt: 0 },
        { type: "tick", now: 99_000, count: 5, auto: false }
      )
    ).toStrictEqual({
      index: 0,
      since: 0,
      changedAt: 0,
    });
  });

  it("a single featured film never advances and has nothing up next", () => {
    expect(
      heroCycle({ index: 0, since: 0, changedAt: 0 }, { type: "next", now: 9, count: 1 })
    ).toStrictEqual({
      index: 0,
      since: 0,
      changedAt: 0,
    });
    expect(upNext(0, 1)).toBeNull();
    expect(upNext(3, 4)).toBe(0);
  });

  it("the hook advances one film per hold while the hero holds focus", () => {
    stubReducedMotion(false);
    const { result } = renderHook(() => useHeroCycle(films(3), true));
    expect(result.current.index).toBe(0);
    expect(result.current.auto).toBe(true);
    act(() => {
      vi.advanceTimersByTime(heroHoldMs);
    });
    expect(result.current.index).toBe(1);
    act(() => {
      vi.advanceTimersByTime(heroHoldMs);
    });
    expect(result.current.index).toBe(2);
  });

  it("reduced motion holds the first film however long it waits, but Next still moves on", () => {
    stubReducedMotion(true);
    const { result } = renderHook(() => useHeroCycle(films(3), true));
    expect(result.current.auto).toBe(false);
    act(() => {
      vi.advanceTimersByTime(heroHoldMs * 5);
    });
    expect(result.current.index).toBe(0);
    act(() => {
      result.current.next();
    });
    expect(result.current.index).toBe(1);
  });

  it("the hero stops advancing while focus is down in the rows", () => {
    stubReducedMotion(false);

    const { result, rerender } = renderHook(({ holding }) => useHeroCycle(films(3), holding), {
      initialProps: { holding: false },
    });

    act(() => {
      vi.advanceTimersByTime(heroHoldMs * 3);
    });
    expect(result.current.index).toBe(0);
    rerender({ holding: true });
    act(() => {
      vi.advanceTimersByTime(heroHoldMs - 1);
    });
    expect(result.current.index).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.index).toBe(1);
  });

  it("any press restarts the hold, so the film never changes while the owner is active", () => {
    stubReducedMotion(false);
    const { result } = renderHook(() => useHeroCycle(films(3), true));
    act(() => {
      vi.advanceTimersByTime(heroHoldMs - 1000);
      touch();
    });
    act(() => {
      vi.advanceTimersByTime(heroHoldMs - 1);
    });
    expect(result.current.index).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.index).toBe(1);
  });

  it("the Play gate follows the last film change, not the last press", () => {
    const changed = heroCycle(
      { index: 0, since: 0, changedAt: 0 },
      { type: "next", now: 10_000, count: 3 }
    );

    expect(settled(changed, 10_000 + heroSettleMs - 1)).toBe(false);
    expect(settled(changed, 10_000 + heroSettleMs)).toBe(true);
    // A press restarts the hold but is no film change, so Play right after it still plays.
    const pressed = heroCycle(changed, { type: "restart", now: 30_000 });
    expect(pressed).toStrictEqual({ index: 1, since: 30_000, changedAt: 10_000 });
    expect(settled(pressed, 30_001)).toBe(true);
  });

  it("Play pressed right after any other press is not dropped", () => {
    stubReducedMotion(false);
    const { result } = renderHook(() => useHeroCycle(films(3), true));
    act(() => {
      vi.advanceTimersByTime(5000);
      touch();
    });
    expect(result.current.settled()).toBe(true);
    act(() => {
      result.current.next();
    });
    expect(result.current.settled()).toBe(false);
    act(() => {
      vi.advanceTimersByTime(heroSettleMs);
    });
    expect(result.current.settled()).toBe(true);
  });

  it("returning to the library resumes the film that was on stage", () => {
    stubReducedMotion(true);
    const first = renderHook(() => useHeroCycle(films(4), true));
    act(() => {
      first.result.current.next();
      first.result.current.next();
    });
    expect(first.result.current.index).toBe(2);
    first.unmount();

    const again = renderHook(() => useHeroCycle(films(4), true));
    expect(again.result.current.index).toBe(2);
    expect(again.result.current.settled()).toBe(true);
  });

  it("the resumed film is found by id after the shuffled list comes back in another order", () => {
    stubReducedMotion(true);
    const first = renderHook(() => useHeroCycle(["a", "b", "c", "d"], true));
    act(() => {
      first.result.current.next();
      first.result.current.next();
    });
    expect(useLit.getState().heroId).toBe("c");
    first.unmount();

    const again = renderHook(() => useHeroCycle(["d", "c", "b", "a"], true));
    expect(again.result.current.index).toBe(1);
  });

  it("a timer that fires a moment before the hold is up still advances the film", () => {
    stubReducedMotion(false);
    const { result } = renderHook(() => useHeroCycle(films(3), true));
    // Timers run on their own clock: shifting Date back makes the 20 s timer fire 5 ms early.
    vi.setSystemTime(Date.now() - 5);
    act(() => {
      vi.advanceTimersByTime(heroHoldMs);
    });
    expect(result.current.index).toBe(0);
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(result.current.index).toBe(1);
  });
});
