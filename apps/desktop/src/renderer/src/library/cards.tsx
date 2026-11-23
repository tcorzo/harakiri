import type { ServerUrl } from "@harakiri/jellyfin";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";

import { episodeCode, imageUrl, minutesLeft } from "../data/entry";
import type { Entry, ImageRef } from "../data/entry";
import { remPx, SeenMark } from "../ui/marks";

export interface CardProps {
  readonly entry: Entry;
  readonly server: ServerUrl;
  readonly focusKey: string;
  readonly onFocus: () => void;
  readonly onPress: () => void;
}

const Picture = ({
  server,
  image,
  widthRem,
  className,
}: {
  readonly server: ServerUrl;
  readonly image: ImageRef | null;
  readonly widthRem: number;
  readonly className: string;
}) => {
  if (image === null) {
    return <div aria-hidden="true" className={`${className} bg-ink-raised`} />;
  }

  return (
    <img
      alt=""
      decoding="async"
      loading="lazy"
      src={imageUrl(server, image, widthRem * remPx())}
      className={`${className} bg-ink-raised object-cover`}
    />
  );
};

const spokenName = (entry: Entry): string => {
  const code = episodeCode(entry);

  const parts = [
    entry.series !== null && entry.kind === "Episode"
      ? `${entry.series.name}, ${code ?? ""}, ${entry.title}`
      : entry.title,
    entry.played ? "seen" : null,
  ];

  return parts.filter((part) => part !== null).join(", ");
};

/**
 * Only a card that stands for one episode carries text: its code, its series and the time left. A film
 * or a series is its picture alone, and its name is spoken, not printed.
 */
export const hasCardText = (entry: Entry): boolean => entry.kind === "Episode";

/** The seen tick on a card with no text, set in the picture's corner on a shade. */
const SeenCorner = () => (
  <span
    aria-hidden="true"
    className="bg-shade text-paper absolute right-2 bottom-2 grid size-8 place-items-center"
  >
    <SeenMark />
  </span>
);

/** An episode's code, series and time left, under its picture. */
const EpisodeText = ({ entry }: { readonly entry: Entry }) => {
  const left = minutesLeft(entry);
  const code = episodeCode(entry);

  return (
    <>
      <span className="text-caption text-paper-dim stretch-condensed flex items-baseline gap-3 font-[600]">
        {code === null ? null : <span>{code}</span>}
        {left === null ? null : <span className="ml-auto">{left} min left</span>}
        {entry.played ? <SeenMark className="text-paper ml-auto shrink-0" /> : null}
      </span>
      <span className="text-body stretch-semicondensed group-focus-visible:text-paper truncate font-[680]">
        {entry.series === null ? entry.title : entry.series.name}
      </span>
    </>
  );
};

/** A landscape still with the progress rule: Continue Watching and Next Up. */
export const StillCard = ({ entry, server, focusKey, onFocus, onPress }: CardProps) => {
  const { ref } = useFocusable<object, HTMLButtonElement>({ focusKey, onFocus });
  const text = hasCardText(entry);

  return (
    <button
      ref={ref}
      type="button"
      aria-label={spokenName(entry)}
      onClick={onPress}
      className="group flex w-[24rem] flex-col gap-3 text-left"
    >
      <span className="focus-mark group-focus-visible:outline-paper relative block group-focus-visible:scale-[1.06]">
        <Picture
          server={server}
          image={entry.still}
          widthRem={24}
          className="block aspect-video w-full"
        />
        {entry.progress === null ? null : (
          <span aria-hidden="true" className="bg-ink/70 absolute inset-x-0 bottom-0 h-[0.375rem]">
            <span
              className="bg-paper block h-full origin-left"
              style={{ transform: `scaleX(${entry.progress})` }}
            />
          </span>
        )}
        {!text && entry.played ? <SeenCorner /> : null}
      </span>
      {text ? <EpisodeText entry={entry} /> : null}
    </button>
  );
};

/** A poster: the programme sections. */
export const PosterCard = ({ entry, server, focusKey, onFocus, onPress }: CardProps) => {
  const { ref } = useFocusable<object, HTMLButtonElement>({ focusKey, onFocus });
  const text = hasCardText(entry);

  return (
    <button
      ref={ref}
      type="button"
      aria-label={spokenName(entry)}
      onClick={onPress}
      className="group flex w-[13.5rem] flex-col gap-3 text-left"
    >
      <span className="focus-mark group-focus-visible:outline-paper relative block group-focus-visible:scale-[1.06]">
        <Picture
          server={server}
          image={entry.poster}
          widthRem={13.5}
          className="block aspect-[2/3] w-full"
        />
        {!text && entry.played ? <SeenCorner /> : null}
      </span>
      {text ? <EpisodeText entry={entry} /> : null}
    </button>
  );
};
