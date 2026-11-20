import type { ReactNode } from "react";

import type { NoteFact } from "../data/entry";

type MarkedState = NonNullable<NoteFact["state"]>;

let cachedRem: number | undefined;

if (typeof window !== "undefined") {
  // rem follows the window height (1rem = 100vh / 67.5), so a resize is the only thing that moves it.
  window.addEventListener("resize", () => {
    cachedRem = undefined;
  });
}

/** CSS pixels per rem, read once per window size rather than once per card per render. */
export const rootRem = (): number => {
  // oxlint-disable-next-line unicorn/prefer-number-coercion -- the value is a CSS length like "16px", which Number() reads as NaN
  cachedRem ??= Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

  return cachedRem;
};

/** Device pixels per rem; rem tracks the screen height, so images are requested at the size they are shown. */
export const remPx = (): number => rootRem() * (window.devicePixelRatio || 1);

export const catalogueLabel = (number: number): string => `No. ${String(number).padStart(3, "0")}`;

/** A pen tick, as a festival-goer marks a film already seen in the printed guide. */
export const SeenMark = ({ className = "" }: { readonly className?: string }) => (
  <svg
    viewBox="0 0 28 22"
    aria-hidden="true"
    className={`inline-block h-[0.85em] w-auto fill-none stroke-current ${className}`}
  >
    <path
      d="M2.5 12.8c2.4 1.4 4.6 3.6 6.4 6.6C13 11.2 18.6 5.4 25.6 2.4"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const stateWords: Record<MarkedState, string> = {
  mapped: "mapped",
  decoded: "decoded",
};

/**
 * Mapped is a half-filled square, decoded an outline: shape carries the state, not colour. A native
 * fact passes as it is and carries no mark at all.
 */
export const StateMark = ({ state }: { readonly state: MarkedState }) => (
  <svg viewBox="0 0 12 12" aria-hidden="true" className="h-[0.8em] w-[0.8em] shrink-0">
    <rect x="1" y="1" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
    {state === "mapped" ? <path d="M1 11 11 1v10Z" fill="currentColor" /> : null}
  </svg>
);

/** The programme note: one condensed line with tabular figures; mapped and decoded facts carry their mark. */
export const ProgrammeNotes = ({
  facts,
  className = "",
}: {
  readonly facts: readonly NoteFact[];
  readonly className?: string;
}) => (
  <p
    className={`text-notes stretch-condensed flex flex-wrap items-baseline gap-x-5 gap-y-2 font-[540] ${className}`}
  >
    {facts.map((fact, i) => (
      <span key={fact.text} className="flex items-baseline gap-5">
        {i > 0 ? (
          <span aria-hidden="true" className="text-paper-faint">
            ·
          </span>
        ) : null}
        <span className="flex items-baseline gap-2">
          <span>{fact.text}</span>
          {fact.state === undefined ? null : (
            <span className="text-paper-dim stretch-semicondensed flex items-center gap-1.5 self-center text-[1.375rem] font-[620] tracking-[0.06em] uppercase">
              <StateMark state={fact.state} />
              {stateWords[fact.state]}
            </span>
          )}
        </span>
      </span>
    ))}
  </p>
);

/**
 * A programme section head: paper type on ink, led by a short red tab, as a printed guide marks
 * its sections. Play stays the only red block that carries horizontal type.
 */
export const SectionHead = ({
  children,
  className = "",
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) => (
  <h2
    className={`text-body text-paper stretch-wide m-0 flex items-center gap-4 font-[760] ${className}`}
  >
    <span aria-hidden="true" className="bg-band block h-[1.5em] w-[0.5rem] shrink-0" />
    {children}
  </h2>
);

/**
 * The margin's section tab: the section name set upward on Harakiri Red. It is as tall as its
 * name, never a full-height rail; only Welcome runs the band the full height of the screen.
 */
export const SectionTab = ({ children }: { readonly children: ReactNode }) => (
  <div className="bg-band flex min-h-[10rem] w-[3.5rem] flex-none items-end justify-center py-4">
    <span className="text-body text-paper stretch-wide rotate-180 font-[760] whitespace-nowrap [writing-mode:vertical-rl]">
      {children}
    </span>
  </div>
);

/**
 * A problem, said in words after a Torch Amber square the height of a capital, so it reads from the
 * couch. Every problem on screen goes through here; red never marks one.
 */
export const Notice = ({
  children,
  className = "",
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) => (
  <p
    role="alert"
    className={`text-body text-paper m-0 flex items-start gap-4 font-[560] ${className}`}
  >
    <span aria-hidden="true" className="bg-alert mt-[0.38em] block size-[0.75em] shrink-0" />
    <span>{children}</span>
  </p>
);
