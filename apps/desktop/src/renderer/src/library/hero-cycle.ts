import { noop } from "es-toolkit";
import { useEffect, useReducer, useSyncExternalStore } from "react";

import { useLit } from "./lit";

/** How long each featured film holds the stage before the next one takes it. */
export const heroHoldMs = 8000;

/** A press this soon after the film changed was aimed at the previous one. */
export const heroSettleMs = 800;

export interface HeroCycle {
  readonly index: number;
  /** When the current film began its hold: when it took the stage, or when the stage was entered. */
  readonly since: number;
  /** When the film on stage last changed on its own. A film the owner chose, or a restart, never moves it. */
  readonly changedAt: number;
}

export type HeroEvent =
  | { readonly type: "tick"; readonly now: number; readonly count: number; readonly auto: boolean }
  | { readonly type: "next"; readonly now: number; readonly count: number }
  | {
      readonly type: "select";
      readonly now: number;
      readonly index: number;
      readonly count: number;
    }
  | { readonly type: "restart"; readonly now: number };

export const heroCycle = (state: HeroCycle, event: HeroEvent): HeroCycle => {
  if (event.type === "restart") {
    return { ...state, since: event.now };
  }

  // A film the owner chose starts its own hold. It does not count as a change for the settle: the
  // owner knows which film is on stage, so a press right after is meant for it.
  if (event.type === "select") {
    const index = ((event.index % event.count) + event.count) % event.count;

    return index === state.index ? state : { ...state, index, since: event.now };
  }

  const due = event.type === "next" || (event.auto && event.now - state.since >= heroHoldMs);

  if (!due || event.count < 2) {
    return state;
  }

  return { index: (state.index + 1) % event.count, since: event.now, changedAt: event.now };
};

/** Whether a press at `now` is meant for the film on stage, rather than the one that just left it. */
export const settled = (state: HeroCycle, now: number): boolean =>
  now - state.changedAt >= heroSettleMs;

export const upNext = (index: number, count: number): number | null =>
  count < 2 ? null : (index + 1) % count;

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

const subscribeReducedMotion = (onChange: () => void): (() => void) => {
  const list = window.matchMedia(reducedMotionQuery);
  list.addEventListener("change", onChange);

  return () => {
    list.removeEventListener("change", onChange);
  };
};

export const useReducedMotion = (): boolean =>
  useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(reducedMotionQuery).matches);

/**
 * Advances the featured film once it has held the stage for a whole hold. Moving between the hero's
 * actions leaves the hold running; choosing a film or coming back to the stage starts it again.
 * Reduced motion never advances on its own; the owner moves through the films with the hero bar.
 */
export const useHeroCycle = (ids: readonly string[], holding: boolean) => {
  const count = ids.length;
  const reducedMotion = useReducedMotion();
  const auto = holding && !reducedMotion;

  // Resumes the film that was on stage when the owner left, which was already settled. It is found
  // by id: the featured list is shuffled, and a refetch puts it in another order.
  const [state, send] = useReducer(heroCycle, undefined, () => ({
    index: Math.max(0, ids.indexOf(useLit.getState().heroId ?? "")),
    since: Date.now(),
    changedAt: 0,
  }));

  const index = count === 0 ? 0 : state.index % count;
  const heroId = ids[index] ?? null;

  useEffect(() => {
    useLit.getState().setHeroId(heroId);
  }, [heroId]);

  useEffect(() => {
    if (holding) {
      send({ type: "restart", now: Date.now() });
    }
  }, [holding]);

  useEffect(() => {
    if (!auto || count < 2) {
      return noop;
    }

    let timer = 0;

    const arm = (): void => {
      timer = window.setTimeout(
        () => {
          // A timer can fire a little before the hold is up; a tick then changes nothing and
          // `since` stays put, so nothing would arm it again. Wait out the rest instead.
          if (Date.now() - state.since < heroHoldMs) {
            arm();
          } else {
            send({ type: "tick", now: Date.now(), count, auto });
          }
        },
        Math.max(0, state.since + heroHoldMs - Date.now())
      );
    };

    arm();

    return () => {
      window.clearTimeout(timer);
    };
  }, [auto, count, state.since]);

  return {
    index,
    since: state.since,
    auto,
    next: () => {
      send({ type: "next", now: Date.now(), count });
    },
    select: (chosen: number) => {
      if (count > 0) {
        send({ type: "select", now: Date.now(), index: chosen, count });
      }
    },
    settled: () => settled(state, Date.now()),
  };
};
