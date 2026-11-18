import type { ServerUrl } from "@harakiri/jellyfin";
import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";

import { episodeCode, imageUrl, minutesLeft, type Entry, type ImageRef } from "../data/entry";
import { catalogueLabel, remPx, SeenMark } from "../ui/marks";

export interface CardProps {
  readonly entry: Entry;
  readonly number: number | null;
  readonly server: ServerUrl;
  readonly focusKey: string;
  readonly onFocus: () => void;
  readonly onPress: () => void;
}

function Picture({
  server,
  image,
  widthRem,
  className,
}: {
  readonly server: ServerUrl;
  readonly image: ImageRef | null;
  readonly widthRem: number;
  readonly className: string;
}) {
  if (image === null) return <div aria-hidden="true" className={`${className} bg-ink-raised`} />;

  return (
    <img
      alt=""
      decoding="async"
      loading="lazy"
      src={imageUrl(server, image, widthRem * remPx())}
      className={`${className} bg-ink-raised object-cover`}
    />
  );
}

function spokenName(entry: Entry, number: number | null): string {
  const code = episodeCode(entry);

  const parts = [
    entry.series !== null && entry.kind === "Episode"
      ? `${entry.series.name}, ${code ?? ""}, ${entry.title}`
      : entry.title,
    number === null ? null : catalogueLabel(number),
    entry.played ? "seen" : null,
  ];

  return parts.filter((part) => part !== null).join(", ");
}

/** A landscape still with the progress rule: Continue Watching and Next Up. */
export function StillCard({ entry, number, server, focusKey, onFocus, onPress }: CardProps) {
  const { ref } = useFocusable<object, HTMLButtonElement>({ focusKey, onFocus });
  const left = minutesLeft(entry);
  const code = episodeCode(entry);

  return (
    <button
      ref={ref}
      type="button"
      aria-label={spokenName(entry, number)}
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
      </span>
      <span className="text-caption text-paper-dim stretch-condensed flex items-baseline gap-3 font-[600]">
        {number === null ? null : <span>{catalogueLabel(number)}</span>}
        {code === null ? null : <span>{code}</span>}
        {left === null ? null : <span className="ml-auto">{left} min left</span>}
      </span>
      <span className="text-body stretch-semicondensed group-focus-visible:text-paper truncate font-[680]">
        {entry.kind === "Episode" && entry.series !== null ? entry.series.name : entry.title}
      </span>
    </button>
  );
}

/** A poster with its catalogue number: the programme sections. */
export function PosterCard({ entry, number, server, focusKey, onFocus, onPress }: CardProps) {
  const { ref } = useFocusable<object, HTMLButtonElement>({ focusKey, onFocus });

  return (
    <button
      ref={ref}
      type="button"
      aria-label={spokenName(entry, number)}
      onClick={onPress}
      className="group flex w-[13.5rem] flex-col gap-3 text-left"
    >
      <span className="focus-mark group-focus-visible:outline-paper block group-focus-visible:scale-[1.06]">
        <Picture
          server={server}
          image={entry.poster}
          widthRem={13.5}
          className="block aspect-[2/3] w-full"
        />
      </span>
      <span className="text-caption text-paper-dim stretch-condensed flex items-center gap-2 font-[600]">
        {number === null ? null : <span>{catalogueLabel(number)}</span>}
        {entry.played ? <SeenMark className="text-paper" /> : null}
      </span>
      <span className="text-body stretch-semicondensed -mt-2 truncate font-[640]">
        {entry.title}
      </span>
    </button>
  );
}
