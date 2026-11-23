import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";

import type { Entry } from "../data/entry";
import { focusFirst } from "../ui/focus";
import { heroHoldMs } from "./hero-cycle";

/** The bar as a whole: focusing it lands on the film on stage. */
export const heroBarKey = "hero-bar";

const segmentPrefix = "hero-film-";

export const heroFilmKey = (index: number): string => `${segmentPrefix}${index}`;

export const isHeroFilmKey = (key: string | null): boolean =>
  key?.startsWith(segmentPrefix) === true;

interface SegmentProps {
  readonly film: Entry;
  readonly index: number;
  readonly current: number;
  readonly since: number;
  readonly auto: boolean;
  readonly focusable: boolean;
  readonly onChoose: (index: number) => void;
}

/**
 * One featured film's segment. Before the film on stage it is full, on it it fills over the hold, and
 * after it the track is empty. Focus thickens it and turns it Harakiri Red: the red marks where the owner is.
 */
const Segment = ({ film, index, current, since, auto, focusable, onChoose }: SegmentProps) => {
  const { ref } = useFocusable<object, HTMLButtonElement>({
    focusKey: heroFilmKey(index),
    focusable,
    onFocus: () => {
      onChoose(index);
    },
  });

  const fill = (): string => {
    if (index < current || (index === current && !auto)) {
      return "scale-x-100";
    }

    return index === current ? "animate-hold" : "scale-x-0";
  };

  return (
    <button
      ref={ref}
      type="button"
      aria-label={film.title}
      aria-current={index === current ? "true" : undefined}
      tabIndex={focusable ? undefined : -1}
      onClick={() => {
        onChoose(index);
        focusFirst("hero-play");
      }}
      className="group flex h-6 min-w-0 flex-1 items-center outline-none"
    >
      <span className="bg-ink-line group-focus-visible:bg-band/45 block h-[0.125rem] w-full transition-[height] duration-200 ease-out group-focus-visible:h-[0.5rem]">
        <span
          // A new hold restarts the fill, so it is keyed by when the hold began.
          key={index === current ? since : "still"}
          className={`bg-paper-dim group-focus-visible:bg-band block h-full origin-left ${fill()}`}
          style={index === current && auto ? { animationDuration: `${heroHoldMs}ms` } : undefined}
        />
      </span>
    </button>
  );
};

/**
 * The featured films as a row of segments, as wide as the actions above it. It shows how long the
 * film on stage holds, and the d-pad moves along it to put another film on stage.
 */
export const HeroBar = ({
  films,
  current,
  since,
  auto,
  focusable,
  onChoose,
}: {
  readonly films: readonly Entry[];
  readonly current: number;
  readonly since: number;
  readonly auto: boolean;
  readonly focusable: boolean;
  readonly onChoose: (index: number) => void;
}) => {
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: heroBarKey,
    focusable,
    trackChildren: true,
    // Entering the bar always lands on the film on stage, not on the segment last visited.
    saveLastFocusedChild: false,
    preferredChildFocusKey: heroFilmKey(current),
  });

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="absolute inset-x-0 top-full mt-4 flex gap-[0.375rem]">
        {films.map((film, index) => (
          <Segment
            key={film.id}
            film={film}
            index={index}
            current={current}
            since={since}
            auto={auto}
            focusable={focusable}
            onChoose={onChoose}
          />
        ))}
      </div>
    </FocusContext.Provider>
  );
};
