import type { ItemId, ServerUrl } from "@harakiri/jellyfin";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import type { FocusableComponentLayout } from "@noriginmedia/norigin-spatial-navigation";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useTransition } from "react";

import { episodeCode, programmeNotes } from "../data/entry";
import type { Entry } from "../data/entry";
import { episodesQuery, seasonsQuery } from "../data/queries";
import { useSignedIn } from "../data/session";
import { Backdrop, backdropUrl, InkField, Margin, TitleMark } from "../library/stage";
import { PlayAction } from "../ui/actions";
import { focusFirst } from "../ui/focus";
import { ProgrammeNotes, SeenMark } from "../ui/marks";
import { seriesPlace } from "./series-place";

const episodeKey = (id: ItemId): string => `episode-${id}`;

const scrollIntoView = ({ node }: FocusableComponentLayout): void => {
  node.scrollIntoView({ block: "nearest" });
};

const SeasonTab = ({
  season,
  selected,
  index,
  onPick,
}: {
  readonly season: Entry;
  readonly selected: boolean;
  readonly index: number;
  readonly onPick: () => void;
}) => {
  const { ref } = useFocusable<object, HTMLButtonElement>({
    focusKey: `season-${index}`,
    onFocus: onPick,
  });

  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      aria-label={season.title}
      onClick={onPick}
      className={`focus-mark text-body stretch-semicondensed focus-visible:bg-paper focus-visible:text-ink shrink-0 border-b-4 px-4 py-2 font-[700] ${
        selected ? "border-band text-paper" : "text-paper-dim border-transparent"
      }`}
    >
      {season.title}
    </button>
  );
};

const EpisodeLine = ({
  episode,
  onFocus,
  onPress,
}: {
  readonly episode: Entry;
  readonly onFocus: () => void;
  readonly onPress: () => void;
}) => {
  const { ref, focused } = useFocusable<object, HTMLButtonElement>({
    focusKey: episodeKey(episode.id),
    onFocus: (layout) => {
      scrollIntoView(layout);
      onFocus();
    },
  });

  const number = episode.series?.episode;

  return (
    <button
      ref={ref}
      type="button"
      aria-label={`${episodeCode(episode) ?? ""} ${episode.title}${episode.played ? ", seen" : ""}`}
      onClick={onPress}
      className="group hairline focus-visible:bg-paper focus-visible:text-ink grid w-full grid-cols-[5rem_minmax(0,1fr)_auto] items-baseline gap-x-6 border-b-2 px-4 py-4 text-left [contain-intrinsic-size:auto_5rem] [content-visibility:auto]"
    >
      <span className="text-heading stretch-condensed font-[300]">
        {number === undefined || number === null ? "—" : String(number).padStart(2, "0")}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-body stretch-semicondensed truncate font-[680]">{episode.title}</span>
        {focused && episode.overview !== null ? (
          <span className="text-caption text-paper-faint group-focus-visible:text-ink line-clamp-2">
            {episode.overview}
          </span>
        ) : null}
        {episode.progress === null ? null : (
          <span aria-hidden="true" className="bg-ink-line mt-1 block h-[0.25rem] w-full">
            <span
              className="bg-paper group-focus-visible:bg-ink block h-full origin-left"
              style={{ transform: `scaleX(${episode.progress})` }}
            />
          </span>
        )}
      </span>
      <span className="text-notes text-paper-dim stretch-condensed group-focus-visible:text-ink flex items-center gap-3">
        {episode.played ? <SeenMark /> : null}
        {episode.minutes === null ? null : `${episode.minutes} min`}
      </span>
    </button>
  );
};

const firstUnwatched = (seasons: readonly Entry[]): number => {
  const found = seasons.findIndex((season) => (season.unplayedCount ?? 0) > 0);

  return found === -1 ? 0 : found;
};

/** The season a series page opens on: the one the owner last had, else the first with unwatched episodes. */
export const initialSeason = (seriesId: ItemId, seasons: readonly Entry[]): number => {
  const remembered = seriesPlace.get(seriesId);

  const given =
    remembered === undefined ? -1 : seasons.findIndex((season) => season.id === remembered.season);

  return given === -1 ? firstUnwatched(seasons) : given;
};

export const SeriesPage = ({
  series,
  number,
  server,
}: {
  readonly series: Entry;
  readonly number: number | null;
  readonly server: ServerUrl;
}) => {
  const ctx = useSignedIn();
  const navigate = useNavigate();
  const { data: seasons } = useSuspenseQuery(seasonsQuery(ctx, series.id));
  const [picked, setPicked] = useState(() => initialSeason(series.id, seasons));
  const [, startTransition] = useTransition();
  const season = seasons[picked] ?? seasons[0];

  // No placeholder: while another season loads, its Play must not start the previous season's episode.
  const episodes = useQuery({
    ...episodesQuery(ctx, series.id, season?.id ?? series.id),
    enabled: season !== undefined,
  });

  const list = episodes.data ?? [];
  const next = list.find((episode) => !episode.played) ?? list[0];

  const { ref, focusKey } = useFocusable<object, HTMLElement>({
    focusKey: "series-page",
    trackChildren: true,
    forceFocus: true,
  });

  // The loader brought the opening season's episodes, so Play (or the remembered episode) is mounted.
  useEffect(() => {
    const episode = seriesPlace.get(series.id)?.episode;
    focusFirst(
      ...(episode === undefined || episode === null ? [] : [episodeKey(episode)]),
      "title-play",
      `season-${picked}`
    );
    // Only on arrival; later season changes keep focus on the season tabs.
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  const pick = (index: number): void => {
    const chosen = seasons[index];

    if (chosen !== undefined) {
      seriesPlace.set(series.id, { season: chosen.id, episode: null });
    }

    startTransition(() => {
      setPicked(index);
    });
  };

  const rememberEpisode = (episode: Entry): void => {
    if (season !== undefined) {
      seriesPlace.set(series.id, { season: season.id, episode: episode.id });
    }
  };

  const open = (episode: Entry): void => {
    void navigate({ to: "/title/$id", params: { id: episode.id } });
  };

  return (
    <FocusContext.Provider value={focusKey}>
      <main
        ref={ref}
        aria-label={series.title}
        className="relative h-screen w-screen overflow-hidden"
      >
        <Backdrop url={series.backdrop === null ? null : backdropUrl(server, series.backdrop)} />
        <InkField deep />
        <div className="inset-x-safe-x bottom-safe-y absolute top-[calc(var(--spacing-safe-y)+5rem)] flex gap-10">
          <Margin number={number} seen={series.played} section="Series" />
          <div className="flex w-[44rem] shrink-0 flex-col justify-end gap-8">
            <TitleMark entry={series} server={server} compact={false} />
            <ProgrammeNotes facts={programmeNotes(series)} />
            <p className="text-body text-paper-dim m-0 line-clamp-6 max-w-[62ch]">
              {series.overview ?? "No synopsis on the server."}
            </p>
            <div className="flex">
              {next === undefined ? null : (
                <PlayAction
                  focusKey="title-play"
                  label={`${next.progress === null ? "Play" : "Resume"} ${episodeCode(next) ?? ""} ${next.title}`}
                  onPress={() => {
                    // Back from the player lands on Play, which by then offers what comes next.
                    if (season !== undefined) {
                      seriesPlace.set(series.id, { season: season.id, episode: null });
                    }

                    void navigate({
                      to: "/screening/$id",
                      params: { id: next.id },
                      search: { start: next.positionTicks },
                    });
                  }}
                >
                  {next.progress === null ? "Play" : "Resume"} {episodeCode(next)}
                </PlayAction>
              )}
            </div>
          </div>
          <section aria-label="Episodes" className="flex min-w-0 flex-1 flex-col gap-4 pl-6">
            <fieldset
              aria-label="Seasons"
              className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
            >
              {seasons.map((s, i) => (
                <SeasonTab
                  key={s.id}
                  season={s}
                  index={i}
                  selected={i === picked}
                  onPick={() => {
                    pick(i);
                  }}
                />
              ))}
            </fieldset>
            <div className="min-h-0 flex-1 overflow-hidden">
              <div className="flex flex-col">
                {list.map((episode) => (
                  <EpisodeLine
                    key={episode.id}
                    episode={episode}
                    onFocus={() => {
                      rememberEpisode(episode);
                    }}
                    onPress={() => {
                      open(episode);
                    }}
                  />
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </FocusContext.Provider>
  );
};
