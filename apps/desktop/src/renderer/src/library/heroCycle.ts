import { useEffect, useReducer, useSyncExternalStore } from "react";
import { useStore } from "zustand";

import { activity } from "../input/activity";
import { useLit } from "./lit";

/** How long the hero waits, with no input at all, before the next featured film takes the screen. */
export const heroHoldMs = 20_000;

/** A press this soon after the film changed was aimed at the previous one. */
export const heroSettleMs = 800;

export interface HeroCycle {
  readonly index: number;
  /** When the current film began its hold; restarts whenever the hold is interrupted. */
  readonly since: number;
  /** When the film on stage last changed. Only a change moves it; a press or a restart never does. */
  readonly changedAt: number;
}

export type HeroEvent =
  | { readonly type: "tick"; readonly now: number; readonly count: number; readonly auto: boolean }
  | { readonly type: "next"; readonly now: number; readonly count: number }
  | { readonly type: "restart"; readonly now: number };

export function heroCycle(state: HeroCycle, event: HeroEvent): HeroCycle {
  if (event.type === "restart") return { ...state, since: event.now };
  const due = event.type === "next" || (event.auto && event.now - state.since >= heroHoldMs);

  if (!due || event.count < 2) return state;

  return { index: (state.index + 1) % event.count, since: event.now, changedAt: event.now };
}

/** Whether a press at `now` is meant for the film on stage, rather than the one that just left it. */
export function settled(state: HeroCycle, now: number): boolean {
  return now - state.changedAt >= heroSettleMs;
}

export function upNext(index: number, count: number): number | null {
  return count < 2 ? null : (index + 1) % count;
}

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const list = window.matchMedia(reducedMotionQuery);
  list.addEventListener("change", onChange);

  return () => list.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(reducedMotionQuery).matches
  );
}

/**
 * Advances the featured film once the hero has held focus with no input for a whole hold, so the
 * film never changes while the owner is reading or reaching for select. Reduced motion never
 * advances on its own; the owner moves on with Next.
 */
export function useHeroCycle(ids: readonly string[], holding: boolean) {
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

  const lastInput = useStore(activity, (s) => s.at);

  useEffect(() => {
    useLit.getState().setHeroId(heroId);
  }, [heroId]);

  useEffect(() => {
    if (holding) send({ type: "restart", now: Math.max(Date.now(), lastInput) });
  }, [holding, lastInput]);

  useEffect(() => {
    if (!auto || count < 2) return () => {};

    let timer = 0;

    const arm = (): void => {
      timer = window.setTimeout(
        () => {
          // A timer can fire a little before the hold is up; a tick then changes nothing and
          // `since` stays put, so nothing would arm it again. Wait out the rest instead.
          if (Date.now() - state.since < heroHoldMs) arm();
          else send({ type: "tick", now: Date.now(), count, auto });
        },
        Math.max(0, state.since + heroHoldMs - Date.now())
      );
    };

    arm();

    return () => window.clearTimeout(timer);
  }, [auto, count, state.since]);

  return {
    index,
    since: state.since,
    auto,
    next: () => send({ type: "next", now: Date.now(), count }),
    settled: () => settled(state, Date.now()),
  };
}
