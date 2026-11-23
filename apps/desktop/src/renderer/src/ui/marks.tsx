import type { ReactNode } from "react";

import dolbyAtmos from "../assets/formats/dolby-atmos.svg";
import dolbyDigitalPlus from "../assets/formats/dolby-digital-plus.svg";
import dolbyDigital from "../assets/formats/dolby-digital.svg";
import dolbyTruehd from "../assets/formats/dolby-truehd.svg";
import dolbyVision from "../assets/formats/dolby-vision.svg";
import dts from "../assets/formats/dts.svg";
import hdr10Plus from "../assets/formats/hdr10-plus.svg";
import hdr10 from "../assets/formats/hdr10.svg";
import type { FormatLogo, NoteFact, NotePart } from "../data/entry";

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

/** A cog with square teeth, cut from the same square geometry as the other marks. */
export const SettingsMark = ({ className = "" }: { readonly className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 fill-current ${className}`}>
    <path d="M9.8 0.6h4.4v5.4h-4.4ZM18.51 2.38 21.62 5.49 17.8 9.31 14.69 6.2ZM23.4 9.8v4.4H18V9.8ZM21.62 18.51 18.51 21.62 14.69 17.8 17.8 14.69ZM14.2 23.4H9.8V18h4.4ZM5.49 21.62 2.38 18.51 6.2 14.69 9.31 17.8ZM0.6 14.2V9.8H6v4.4ZM2.38 5.49 5.49 2.38 9.31 6.2 6.2 9.31ZM12 3.6a8.4 8.4 0 1 1 0 16.8 8.4 8.4 0 1 1 0-16.8ZM12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 1 0 0-6.8Z" />
  </svg>
);

/** Each logo as a luminance mask (ink white, paper black), cropped to its ink, with its width over height. */
const formatLogos: Record<FormatLogo, { readonly url: string; readonly aspect: number }> = {
  "dolby-vision": { url: dolbyVision, aspect: 6.833 },
  hdr10: { url: hdr10, aspect: 2.876 },
  "hdr10-plus": { url: hdr10Plus, aspect: 3.28 },
  "dolby-atmos": { url: dolbyAtmos, aspect: 7.206 },
  "dolby-truehd": { url: dolbyTruehd, aspect: 3.993 },
  "dolby-digital-plus": { url: dolbyDigitalPlus, aspect: 2.826 },
  "dolby-digital": { url: dolbyDigital, aspect: 2.852 },
  dts: { url: dts, aspect: 2.547 },
};

/** A format's logo painted in the current text colour, so it sits in the paper-on-ink palette. */
export const FormatLogoMark = ({
  logo,
  className = "",
}: {
  readonly logo: FormatLogo;
  readonly className?: string;
}) => {
  const { url, aspect } = formatLogos[logo];

  return (
    <span
      aria-hidden="true"
      className={`inline-block h-[0.8em] shrink-0 bg-current ${className}`}
      style={{
        aspectRatio: aspect,
        maskImage: `url("${url}")`,
        maskMode: "luminance",
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
      }}
    />
  );
};

/** A fact drawn from its parts (logos and words), with the whole fact as words for assistive tech. */
export const NoteFactBody = ({ fact }: { readonly fact: NoteFact }) => {
  const parts: readonly NotePart[] = fact.parts ?? [{ text: fact.text }];

  return (
    <>
      <span aria-hidden="true" className="flex items-center gap-[0.5em]">
        {parts.map((part) =>
          "logo" in part ? (
            <FormatLogoMark key={part.logo} logo={part.logo} />
          ) : (
            <span key={part.text}>{part.text}</span>
          )
        )}
      </span>
      <span className="sr-only">{fact.text}</span>
    </>
  );
};

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

/** The programme notes as quiet half-strength ink badges; mapped and decoded facts lead with their mark. */
export const ProgrammeNotes = ({
  facts,
  seen = false,
  className = "",
}: {
  readonly facts: readonly NoteFact[];
  readonly seen?: boolean;
  readonly className?: string;
}) => (
  <p
    className={`text-paper-dim stretch-condensed m-0 flex flex-wrap items-stretch gap-1.5 text-[1.25rem] font-[560] ${className}`}
  >
    {facts.map((fact) => (
      <span
        key={fact.text}
        className="flex items-center gap-2 bg-[color-mix(in_oklch,var(--color-ink-raised)_55%,transparent)] px-[0.6rem] py-[0.2rem]"
      >
        {fact.state === undefined ? null : (
          <span
            className="hairline flex items-center border-r-2 pr-2"
            title={stateWords[fact.state]}
          >
            <StateMark state={fact.state} />
            <span className="sr-only">{stateWords[fact.state]}</span>
          </span>
        )}
        <NoteFactBody fact={fact} />
      </span>
    ))}
    {seen ? (
      <span className="flex items-center bg-[color-mix(in_oklch,var(--color-ink-raised)_55%,transparent)] px-[0.6rem] py-[0.2rem]">
        <SeenMark />
        <span className="sr-only">Seen</span>
      </span>
    ) : null}
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
