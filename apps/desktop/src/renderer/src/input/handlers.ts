import type { Direction } from "@harakiri/input";
import { useEffect, useEffectEvent } from "react";

type Handled = "back" | "menu" | "playPause";

/**
 * The last-mounted screen that claims an action answers it; the hub falls back when none does.
 * React runs a child's effects before its parent's, so "last mounted" is not "innermost": a sheet
 * opened over a page mounts after it and wins, which is the case these stacks exist for.
 */
const stacks: Record<Handled, (() => void)[]> = { back: [], menu: [], playPause: [] };

export function dispatch(action: Handled): boolean {
  const handler = stacks[action].at(-1);

  if (handler === undefined) return false;
  handler();

  return true;
}

export function useActionHandler(action: Handled, handler: () => void): void {
  const onAction = useEffectEvent(handler);
  useEffect(() => {
    const entry = (): void => onAction();
    stacks[action].push(entry);

    return () => {
      const stack = stacks[action];
      stack.splice(stack.lastIndexOf(entry), 1);
    };
  }, [action]);
}

/** Returns true when it moved focus itself, so the spatial search must not run. */
type Guard = (direction: Direction) => boolean;

const guards: Guard[] = [];

/** Lets the last-mounted guard take a d-pad move the spatial search would get wrong. */
export function guardNavigation(direction: Direction): boolean {
  return guards.at(-1)?.(direction) ?? false;
}

export function useNavigationGuard(guard: Guard): void {
  const onMove = useEffectEvent(guard);
  useEffect(() => {
    const entry: Guard = (direction) => onMove(direction);
    guards.push(entry);

    return () => {
      guards.splice(guards.lastIndexOf(entry), 1);
    };
  }, []);
}
