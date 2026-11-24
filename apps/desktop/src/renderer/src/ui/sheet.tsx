import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { createContext, use, useCallback, useEffect, useRef } from "react";
import type { ComponentProps, ReactNode } from "react";

import { useActionHandler } from "../input/handlers";
import { ListAction } from "./actions";
import { SectionHead } from "./marks";

/** Plays the sheet back into the wings, then runs `then`. */
type LeaveSheet = (then: () => void) => void;

const LeaveContext = createContext<LeaveSheet>((then) => {
  then();
});

// The exit mirrors the entrance in styles.css, faster and accelerating away.
const exitTiming: KeyframeAnimationOptions = {
  duration: 200,
  easing: "cubic-bezier(0.7, 0, 0.84, 0)",
  fill: "forwards",
};

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A raised panel from the right that holds focus until the owner answers it; Back closes it. Its
 * owner focuses a row once it mounts. Rows that close it are `SheetAction`s, so it can exit first.
 */
export const Sheet = ({
  title,
  focusKey,
  onClose,
  children,
}: {
  readonly title: string;
  readonly focusKey: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) => {
  const { ref, focusKey: boundary } = useFocusable<object, HTMLElement>({
    focusKey,
    isFocusBoundary: true,
  });

  const house = useRef<HTMLDivElement>(null);
  const exits = useRef<Animation[] | null>(null);

  useEffect(
    () => () => {
      for (const exit of exits.current ?? []) {
        exit.cancel();
      }
    },
    []
  );

  // Stable, since it only reads refs, so the rows under the context do not re-render with the sheet.
  const leave = useCallback<LeaveSheet>(
    (then) => {
      // A second Back or press while the sheet is already leaving changes nothing.
      if (exits.current !== null) {
        return;
      }

      const panel = ref.current;

      if (reducedMotion() || panel === null || house.current === null) {
        exits.current = [];
        then();

        return;
      }

      const running = [
        panel.animate([{ transform: "translateX(100%)" }], exitTiming),
        house.current.animate([{ opacity: 0 }], exitTiming),
      ];

      exits.current = running;

      // A cancelled exit (the page went away underneath) rejects, and must not close anything.
      Promise.all(running.map(async (exit) => await exit.finished))
        .then(then)
        .catch(() => null);
    },
    [ref]
  );

  useActionHandler(
    "back",
    () => {
      leave(onClose);
    },
    "overlay"
  );

  return (
    <>
      <div
        ref={house}
        aria-hidden="true"
        className="bg-house/50 animate-house-down absolute inset-0 z-20"
      />
      <FocusContext.Provider value={boundary}>
        <section
          ref={ref}
          aria-label={title}
          className="bg-ink-raised pr-safe-x py-safe-y animate-wings-in [&>h2>span]:animate-cue absolute inset-y-0 right-0 z-20 flex w-[46rem] flex-col gap-6 pl-12 shadow-[-1.5rem_0_4rem_var(--color-shade)] [&>h2>span]:origin-bottom"
        >
          <SectionHead>{title}</SectionHead>
          <div className="-mx-3 flex flex-col overflow-hidden px-3 py-2">
            <LeaveContext value={leave}>{children}</LeaveContext>
          </div>
        </section>
      </FocusContext.Provider>
    </>
  );
};

/** A sheet row whose press closes the sheet: it plays the exit, then runs `then`. */
export const SheetAction = ({
  then,
  ...props
}: Omit<ComponentProps<typeof ListAction>, "onPress"> & { readonly then: () => void }) => {
  const leave = use(LeaveContext);

  return (
    <ListAction
      {...props}
      onPress={() => {
        leave(then);
      }}
    />
  );
};
