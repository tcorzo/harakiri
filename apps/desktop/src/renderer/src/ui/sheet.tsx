import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { createContext, use, useCallback, useEffect, useRef } from "react";
import type { ComponentProps, ReactNode } from "react";

import { useActionHandler, useNavigationGuard } from "../input/handlers";
import { ListAction } from "./actions";
import { holdFocusWithin } from "./focus";
import { SectionHead } from "./marks";

/** Runs a row's press: closing rows play the exit first; every press is dropped once it leaves. */
type Answer = (then: () => void, closes: boolean) => void;

const AnswerContext = createContext<Answer>((then) => {
  then();
});

// The exit mirrors the entrance in styles.css, faster and accelerating away.
const exitTiming: KeyframeAnimationOptions = {
  duration: 200,
  easing: "cubic-bezier(0.7, 0, 0.84, 0)",
  fill: "forwards",
};

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const noRelease = (): void => undefined;

/**
 * A raised panel from the right that holds focus until the owner answers it; Back closes it. Its
 * owner focuses a row once it mounts. Its rows are `SheetAction`s, so it can exit before it closes.
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
  const release = useRef(noRelease);

  // Runs before the owner's own mount effect, which focuses a row inside the hold.
  useEffect(() => {
    if (ref.current !== null) {
      release.current = holdFocusWithin(ref.current);
    }

    return () => {
      release.current();

      for (const exit of exits.current ?? []) {
        exit.cancel();
      }
    };
  }, [ref]);

  // Stable, since it only reads refs, so the rows under the context do not re-render with the sheet.
  const answer = useCallback<Answer>(
    (then, closes) => {
      // Once the sheet is leaving, its answer is given: a later Back or press changes nothing.
      if (exits.current !== null) {
        return;
      }

      if (!closes) {
        then();

        return;
      }

      // The close hands focus back to the page, so the hold ends before it runs.
      const close = (): void => {
        release.current();
        then();
      };

      const panel = ref.current;

      if (reducedMotion() || panel === null || house.current === null) {
        exits.current = [];
        close();

        return;
      }

      const running = [
        panel.animate([{ transform: "translateX(100%)" }], exitTiming),
        house.current.animate([{ opacity: 0 }], exitTiming),
      ];

      exits.current = running;

      // A cancelled exit (the page went away underneath) rejects, and must not close anything.
      Promise.all(running.map(async (exit) => await exit.finished))
        .then(close)
        .catch(() => null);
    },
    [ref]
  );

  useActionHandler(
    "back",
    () => {
      answer(onClose, true);
    },
    "modal"
  );
  // Outranks a guard from anything that mounts under the sheet; the spatial search stays inside it.
  useNavigationGuard(() => false, "modal");

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
            <AnswerContext value={answer}>{children}</AnswerContext>
          </div>
        </section>
      </FocusContext.Provider>
    </>
  );
};

/**
 * A sheet row. Its press runs `then`; a row that `closes` (the default) plays the sheet's exit
 * first. Once the sheet is leaving, no row answers.
 */
export const SheetAction = ({
  then,
  closes = true,
  ...props
}: Omit<ComponentProps<typeof ListAction>, "onPress"> & {
  readonly then: () => void;
  readonly closes?: boolean;
}) => {
  const answer = use(AnswerContext);

  return (
    <ListAction
      {...props}
      onPress={() => {
        answer(then, closes);
      }}
    />
  );
};
