import type { Direction } from "@harakiri/input";
import { useEffect, useEffectEvent } from "react";

type Handled = "back" | "menu" | "playPause";

/**
 * Who a claim belongs to. A screen claims as a `page`. Something drawn over it that holds focus
 * until the owner answers it claims as an `overlay`, and answers before every page claim.
 */
export type ClaimLayer = "page" | "overlay";

interface Claim<T> {
  readonly run: T;
  readonly layer: ClaimLayer;
}

/**
 * The last-mounted claim answers, an overlay's before any page's; the hub falls back when none
 * does. React runs a child's effects before its parent's, so "last mounted" is not "innermost":
 * a sheet opened over a page mounts after it and wins, which is the case these stacks exist for.
 * Something that can appear in its page's own first render (a card drawn from cached data)
 * registers before its page does, so it claims as an overlay instead.
 */
const top = <T>(claims: readonly Claim<T>[]): T | undefined =>
  (claims.findLast((claim) => claim.layer === "overlay") ?? claims.at(-1))?.run;

const stacks: Record<Handled, Claim<() => void>[]> = { back: [], menu: [], playPause: [] };

export const dispatch = (action: Handled): boolean => {
  const handler = top(stacks[action]);

  if (handler === undefined) {
    return false;
  }

  handler();

  return true;
};

export const useActionHandler = (
  action: Handled,
  handler: () => void,
  layer: ClaimLayer = "page"
): void => {
  const onAction = useEffectEvent(handler);
  useEffect(() => {
    const entry: Claim<() => void> = {
      run: () => {
        onAction();
      },
      layer,
    };

    stacks[action].push(entry);

    return () => {
      const stack = stacks[action];
      stack.splice(stack.lastIndexOf(entry), 1);
    };
  }, [action, layer]);
};

/** Returns true when it moved focus itself, so the spatial search must not run. */
type Guard = (direction: Direction) => boolean;

const guards: Claim<Guard>[] = [];

/** Lets the top guard, chosen as the action stacks choose, take a move the spatial search would get wrong. */
export const guardNavigation = (direction: Direction): boolean => top(guards)?.(direction) ?? false;

export const useNavigationGuard = (guard: Guard, layer: ClaimLayer = "page"): void => {
  const onMove = useEffectEvent(guard);
  useEffect(() => {
    const entry: Claim<Guard> = { run: (direction) => onMove(direction), layer };
    guards.push(entry);

    return () => {
      guards.splice(guards.lastIndexOf(entry), 1);
    };
  }, [layer]);
};
