import { ItemId } from "@harakiri/jellyfin";
import type { ServerUrl } from "@harakiri/jellyfin";
import {
  FocusContext,
  getCurrentFocusKey,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import { useQueries, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import type { QueryObserverResult } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { noop } from "es-toolkit";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { ComponentType, ReactNode } from "react";
import { preload } from "react-dom";

import type { Entry } from "../data/entry";
import {
  continueQuery,
  featuredQuery,
  programmeQuery,
  rawItemQuery,
  recentQuery,
  seasonsQuery,
  titleQuery,
  upNextQuery,
} from "../data/queries";
import { useSignedIn } from "../data/session";
import { useActionHandler, useNavigationGuard } from "../input/handlers";
import { LauncherCard, launcherAddKey } from "../launcher/launcher-card";
import { PlayAction, QuietAction } from "../ui/actions";
import { CraneMark } from "../ui/brand";
import { focusFirst } from "../ui/focus";
import { SettingsMark } from "../ui/marks";
import { hasCardText, PosterCard, StillCard } from "./cards";
import type { CardProps } from "./cards";
import { useBackToLeave } from "./exit-sheet";
import { HeroBar, heroFilmKey, isHeroFilmKey } from "./hero-bar";
import { upNext, useHeroCycle } from "./hero-cycle";
import { cardKey, restoreKeys, tonight, useLit } from "./lit";
import type { Section } from "./lit";
import { useStageFace } from "./presented-face";
import { FailedRow, ProgrammeRow, retryKey } from "./programme-row";
import { Backdrop, backdropUrl, EntryNotes, InkField, TitleMark } from "./stage";

const noItem = ItemId.parse("00000000000000000000000000000000");

interface RowLayout {
  readonly Card: ComponentType<CardProps>;
  readonly pitchRem: number;
  readonly heightRem: number;
}

/**
 * A row's height: its pictures, plus the episode text under them when any card in it is an episode.
 * Each picture height leaves room for the focused card's scale.
 */
interface CardSizes {
  readonly Card: ComponentType<CardProps>;
  readonly pitchRem: number;
  readonly pictureRem: number;
  readonly textRem: number;
}

const still: CardSizes = { Card: StillCard, pitchRem: 26, pictureRem: 14, textRem: 5.5 };
const poster: CardSizes = { Card: PosterCard, pitchRem: 15.5, pictureRem: 21, textRem: 5.5 };

const layoutFor = (sizes: CardSizes, entries: readonly Entry[]): RowLayout => ({
  Card: sizes.Card,
  pitchRem: sizes.pitchRem,
  heightRem: sizes.pictureRem + (entries.some(hasCardText) ? sizes.textRem : 0),
});

/** A failed section holds one line and its retry action. */
const failedHeightRem = 4.5;

/** Header, padding and the gap to the next section, around each row's cards (rem). */
const rowChromeRem = 3 + 1.25 + 3 + 3;

/** Where the focused row's top edge rests once focus leaves the hero (rem from the top). */
const rowAnchorRem = 31;

/**
 * The rows' horizon: nothing in them paints above this line, just over the focused row's top edge,
 * so a row that focus leaves slides under the banner instead of across it. It feathers out over
 * `horizonFeatherRem` above (rem from the top).
 */
const horizonRem = rowAnchorRem - 0.75;
const horizonFeatherRem = 3;

/** Where the hero block's bottom edge sits once focus is in the rows (rem from the bottom). */
const heroBottomRem = 12.5;

/**
 * How far the hero block drops while it holds the stage. The rows wait out of sight below the
 * screen then, so the block rests low and leaves the hold rule and the scroll cue under it.
 */
const heroRestDropRem = 4.5;

type PlannedRow =
  | ({
      readonly kind: "entries";
      readonly section: Section;
      readonly entries: readonly Entry[];
    } & RowLayout)
  | {
      readonly kind: "failed";
      readonly section: Section;
      readonly heightRem: number;
      readonly handleRetry: () => void;
    };

const failed = (section: Section, refetch: () => Promise<QueryObserverResult>): PlannedRow => ({
  kind: "failed",
  section,
  heightRem: failedHeightRem,
  handleRetry: () => {
    void refetch();
  },
});

/**
 * The programme rows, each from its own request. A failed request becomes a failed row with its
 * own retry, so one bad section never takes the library down. Null until every request settles,
 * so the rows appear together rather than shifting under the owner's focus.
 */
const useProgramme = (): readonly PlannedRow[] | null => {
  const ctx = useSignedIn();

  const [resume, nextUp, recent, sections] = useQueries({
    queries: [continueQuery(ctx), upNextQuery(ctx), recentQuery(ctx), programmeQuery(ctx)],
  });

  // An episode already in Continue Watching would otherwise appear twice in a row. Memoized so
  // the row keeps the same entries, and its memo holds, while nothing changed.
  const nextUpEntries = useMemo(() => {
    const resuming = new Set((resume.data ?? []).map((entry) => entry.id));

    return nextUp.data?.filter((entry) => !resuming.has(entry.id));
  }, [resume.data, nextUp.data]);

  if ([resume, nextUp, recent, sections].some((query) => query.isPending)) {
    return null;
  }

  // Rebuilt each render, which is cheap: the rows themselves are memoized on stable data.
  const rows: PlannedRow[] = [];

  const add = (
    section: Section,
    query: {
      readonly data: readonly Entry[] | undefined;
      readonly refetch: () => Promise<QueryObserverResult>;
    },
    sizes: CardSizes
  ): void => {
    if (query.data === undefined) {
      rows.push(failed(section, query.refetch));
    } else if (query.data.length > 0) {
      rows.push({ kind: "entries", section, entries: query.data, ...layoutFor(sizes, query.data) });
    }
  };

  add({ id: "resume", name: "Continue Watching" }, resume, still);
  add({ id: "next-up", name: "Next Up" }, { ...nextUp, data: nextUpEntries }, still);
  add({ id: "latest", name: "Recently Added" }, recent, poster);

  if (sections.data === undefined) {
    rows.push(failed({ id: "genres", name: "Programme" }, sections.refetch));
  } else {
    for (const section of sections.data) {
      if (section.entries.length > 0) {
        rows.push({
          kind: "entries",
          section: { id: section.id, name: section.title },
          entries: section.entries,
          ...layoutFor(poster, section.entries),
        });
      }
    }
  }

  return rows;
};

const rowTop = (rows: readonly PlannedRow[], index: number): number => {
  let top = 0;

  for (const row of rows.slice(0, Math.max(0, index - 1))) {
    top += row.heightRem + rowChromeRem;
  }

  return top;
};

const relightRestMs = 180;
let relightTimer = 0;

const useOpenEntry = (): ((entry: Entry) => void) => {
  const navigate = useNavigate();

  return useCallback(
    (entry: Entry) => {
      void navigate({ to: "/title/$id", params: { id: entry.id } });
    },
    [navigate]
  );
};

const ProgrammeView = ({
  server,
  rows,
  hero,
}: {
  readonly server: ServerUrl;
  readonly rows: readonly PlannedRow[];
  readonly hero: boolean;
}) => {
  const ctx = useSignedIn();
  const onPressEntry = useOpenEntry();
  const queryClient = useQueryClient();
  const activeId = useLit((s) => s.section.id);
  const travelling = useLit((s) => s.travelling);
  const found = rows.findIndex((row) => row.section.id === activeId) + 1;
  // With no featured film there is no stage to rest on, so the first row leads.
  const active = found === 0 && !hero ? 1 : found;

  const offset = active === 0 ? "100vh" : `${rowAnchorRem - rowTop(rows, active)}rem`;

  const onFocusEntry = useCallback(
    (entry: Entry, section: Section): void => {
      const lit = useLit.getState();
      // The section moves at once so a held d-pad scrolls; the field re-lights once focus rests.
      lit.enter(section);
      lit.remember({ section: section.id, entry: entry.id });
      window.clearTimeout(relightTimer);
      relightTimer = window.setTimeout(() => {
        useLit.getState().light(entry, section);
        // Only a card the owner rests on is worth fetching in full.
        void queryClient.query(rawItemQuery(ctx, entry.id)).catch(noop);

        if (entry.kind === "Series") {
          void queryClient.query(seasonsQuery(ctx, entry.id)).catch(noop);
        }

        if (entry.backdrop !== null) {
          preload(backdropUrl(server, entry.backdrop), { as: "image" });
        }
      }, relightRestMs);
    },
    [ctx, queryClient, server]
  );

  const first = rows[0]?.section.id;

  // Returning from a title page lands back on the card the owner left, found by id.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) {
      return;
    }

    restored.current = true;
    const { place } = useLit.getState();

    // The launcher card holds focus while it shows, so it comes before any remembered place.
    if (place !== null || !hero) {
      focusFirst(launcherAddKey, ...restoreKeys(place, hero, first));
    }
  }, [hero, first]);

  return (
    // The horizon stays put while the rows move under it.
    <div
      className="absolute inset-0"
      style={{
        maskImage: `linear-gradient(to bottom, transparent ${horizonRem - horizonFeatherRem}rem, black ${horizonRem}rem)`,
      }}
    >
      <div
        // A held d-pad moves a row every 120 ms, faster than the 700 ms glide, so while it travels the
        // rows jump with focus and the glide returns once it rests (the relight ends the travel).
        className={`ease-curtain pl-safe-x absolute inset-x-0 top-0 flex flex-col gap-12 ${
          travelling ? "" : "transition-transform duration-700"
        }`}
        style={{ transform: `translateY(${offset})` }}
      >
        {rows.map((row, i) => (
          <div
            key={row.section.id}
            // Rows waiting below dim their pictures only; their type keeps full contrast.
            // A passed row leaves fast, so it is gone before it reaches the horizon's feather; a row
            // coming back down returns slowly.
            className={`transition-opacity [&_img]:transition-opacity [&_img]:duration-500 ${
              i + 1 < active ? "opacity-0 duration-150" : "opacity-100 duration-500"
            } ${i + 1 > active && active !== 0 ? "[&_img]:opacity-50" : ""}`}
          >
            {row.kind === "failed" ? (
              <FailedRow
                sectionId={row.section.id}
                sectionName={row.section.name}
                onRetry={row.handleRetry}
              />
            ) : (
              <ProgrammeRow
                sectionId={row.section.id}
                sectionName={row.section.name}
                entries={row.entries}
                Card={row.Card}
                pitchRem={row.pitchRem}
                heightRem={row.heightRem}
                server={server}
                onFocusEntry={onFocusEntry}
                onPressEntry={onPressEntry}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const Programme = memo(ProgrammeView);

/**
 * While the hero holds the full screen, the rows wait out of sight; one thin arrow, drifting
 * slowly, says there is more below. Down on the d-pad reaches it, so the cue never takes focus.
 */
const ScrollCue = ({ shown }: { readonly shown: boolean }) => (
  <div
    aria-hidden="true"
    className={`text-paper-dim absolute bottom-[calc(var(--spacing-safe-y)/2)] left-1/2 -translate-x-1/2 transition-opacity duration-500 ${
      shown ? "opacity-100" : "opacity-0"
    }`}
  >
    <svg viewBox="0 0 24 24" className="animate-drift block size-8 fill-none stroke-current">
      <path d="M5 9l7 7 7-7" strokeWidth="1.5" />
    </svg>
  </div>
);

const SettingsLink = () => {
  const navigate = useNavigate();
  const { ref } = useFocusable<object, HTMLButtonElement>({ focusKey: "library-settings" });

  return (
    <button
      ref={ref}
      type="button"
      aria-label="Settings"
      onClick={() => {
        void navigate({ to: "/settings" });
      }}
      // Full paper, not dim: it sits on the thin top wash, over whatever the backdrop's sky is.
      className="focus-mark text-paper focus-visible:bg-paper focus-visible:text-ink flex size-[3.5rem] items-center justify-center"
    >
      <SettingsMark className="size-[2.25rem]" />
    </button>
  );
};

const EmptyLibrary = ({ children }: { readonly children: ReactNode }) => {
  useEffect(() => {
    focusFirst("library-settings");
  }, []);

  return (
    <main className="px-safe-x py-safe-y relative flex h-screen flex-col justify-end gap-6">
      <h1 className="text-marquee stretch-extra-wide m-0 font-[820]">An empty programme</h1>
      <p className="text-body text-paper-dim max-w-[60ch]">
        The server has no films or series this account can see yet. Add a library on the server, let
        it scan, then come back.
      </p>
      <div>
        <SettingsLink />
      </div>
      {children}
    </main>
  );
};

interface Stage {
  readonly hero: boolean;
  /** The focus key of the film on stage in the bar; null when there is no bar. */
  readonly film: string | null;
  readonly firstRow: string | undefined;
}

const isActionKey = (key: string): boolean => key === "hero-play" || key === "hero-details";

/**
 * The moves on the stage the spatial search would get wrong, made by hand: Down from the actions to
 * the film on stage in the bar, Up from the bar to Play, and Up from the first row back to the bar
 * (or Play, with a single featured film). True when it moved focus itself.
 */
const stageMove = (direction: string, key: string | null, stage: Stage): boolean => {
  if (key === null || !stage.hero) {
    return false;
  }

  if (direction === "down" && isActionKey(key) && stage.film !== null) {
    return focusFirst(stage.film);
  }

  if (direction === "up" && isHeroFilmKey(key)) {
    return focusFirst("hero-play");
  }

  const { firstRow } = stage;

  const inFirstRow =
    firstRow !== undefined && (key.startsWith(cardKey(firstRow, "")) || key === retryKey(firstRow));

  if (direction === "up" && inFirstRow) {
    return stage.film === null ? focusFirst("hero-play") : focusFirst(stage.film, "hero-play");
  }

  return false;
};

/**
 * The stage reads top to bottom: actions, then the film bar, then the rows. The spatial search
 * cannot see the rows while they wait below, and would land on whichever segment is nearest. When
 * the next film takes the stage while the owner is on the bar, focus moves along with it.
 */
const useStageNavigation = (
  hero: boolean,
  films: number,
  current: number,
  rows: readonly PlannedRow[] | null
): void => {
  const stage: Stage = {
    hero,
    film: films > 1 ? heroFilmKey(current) : null,
    firstRow: rows?.[0]?.section.id,
  };

  useNavigationGuard((direction) => {
    const key: string | null = getCurrentFocusKey();

    return stageMove(direction, key, stage);
  });

  useEffect(() => {
    if (stage.film !== null && isHeroFilmKey(getCurrentFocusKey())) {
      focusFirst(stage.film);
    }
  }, [stage.film]);
};

const preloadBackdrop = (server: ServerUrl, entry: Entry | null): void => {
  if (entry?.backdrop !== undefined && entry.backdrop !== null) {
    preload(backdropUrl(server, entry.backdrop), { as: "image" });
  }
};

export const LibraryScreen = () => {
  const ctx = useSignedIn();
  const { server } = ctx;
  const navigate = useNavigate();
  const openEntry = useOpenEntry();
  const { data: featured } = useSuspenseQuery(featuredQuery(ctx));
  const rows = useProgramme();
  const section = useLit((s) => s.section);
  const litEntry = useLit((s) => s.entry);
  const light = useLit((s) => s.light);
  const featuredIds = useMemo(() => featured.map((film) => film.id), [featured]);
  const cycle = useHeroCycle(featuredIds, section.id === tonight.id);
  const hero = featured[cycle.index] ?? null;
  const holding = section.id === tonight.id && hero !== null;
  const nextIndex = upNext(cycle.index, featured.length);
  const next = nextIndex === null ? null : (featured[nextIndex] ?? null);
  const lit = holding ? hero : (litEntry ?? hero);

  // Row items arrive without media streams; the full item fills in the notes once it lands.
  const detail = useQuery({
    ...titleQuery(ctx, lit?.id ?? noItem),
    enabled: lit !== null,
  });

  const shown = detail.data?.entry ?? lit;
  // The full title has landed, or failed: either way the block stops waiting for it.
  const { face, visible, staged } = useStageFace(server, holding, shown, !detail.isPending);

  const { ref, focusKey } = useFocusable<object, HTMLElement>({
    focusKey: "library",
    trackChildren: true,
    // A press with nothing focused (a key that went away) recovers here instead of doing nothing.
    forceFocus: true,
  });

  useActionHandler("menu", () => {
    void navigate({ to: "/settings" });
  });
  const exitSheet = useBackToLeave(holding, hero !== null);

  useEffect(() => {
    if (useLit.getState().place !== null) {
      return;
    }

    useLit.setState({ entry: null, section: tonight });
    // A card drawn from a cached status registers in this same render, before this effect runs.
    focusFirst(launcherAddKey, "hero-play");
  }, []);

  preloadBackdrop(server, next);

  useStageNavigation(hero !== null, featured.length, cycle.index, rows);

  if (hero === null && rows !== null && rows.length === 0) {
    return <EmptyLibrary>{exitSheet}</EmptyLibrary>;
  }

  const playHero = (): void => {
    // A press in the instant the film changed was meant for the film that just left.
    if (hero === null || !cycle.settled()) {
      return;
    }

    void navigate({
      to: "/screening/$id",
      params: { id: hero.id },
      search: { start: hero.positionTicks, after: "title" },
    });
  };

  const lightHero = (): void => {
    if (hero === null) {
      return;
    }

    window.clearTimeout(relightTimer);
    useLit.setState({ place: null });
    light(hero, tonight);
  };

  const chooseFilm = (index: number): void => {
    const film = featured[index];

    if (film === undefined) {
      return;
    }

    cycle.select(index);
    window.clearTimeout(relightTimer);
    useLit.setState({ place: null });
    light(film, tonight);
  };

  const heroPanel = (): ReactNode => {
    if (shown === null) {
      return null;
    }

    return (
      <section
        aria-label={holding ? "Tonight's screening" : shown.title}
        className="left-safe-x ease-curtain absolute flex transition-transform duration-700"
        style={{
          bottom: `${heroBottomRem}rem`,
          // Holding, the block rests low over the full-screen stage; in the rows it lifts so its last
          // visible line rests just above the focused row.
          transform: holding
            ? `translateY(${heroRestDropRem}rem)`
            : `translateY(calc(${rowAnchorRem + 4.25 + heroBottomRem}rem - 100vh))`,
        }}
      >
        <div
          className={`flex w-[calc(100vw-2*var(--spacing-safe-x))] flex-col gap-7 ${
            staged ? "items-center text-center" : "items-start text-left"
          }`}
        >
          {face === null ? null : (
            <div
              // The title and notes change only while they are out: they leave fast, and return on the
              // curtain ease. The actions and the film bar below stay put through a change of film.
              className={`flex flex-col gap-7 transition-opacity ${
                visible
                  ? "ease-curtain opacity-100 duration-[420ms]"
                  : "opacity-0 duration-100 ease-out"
              } ${staged ? "items-center" : "items-start"}`}
            >
              <TitleMark
                entry={face.entry}
                server={server}
                compact={!face.staged}
                hero={face.staged}
              />
              <EntryNotes entry={face.entry} centred={face.staged}>
                {face.staged || face.entry.overview === null ? null : (
                  <p className="text-body text-paper-dim line-clamp-2 max-w-[60ch]">
                    {face.entry.overview}
                  </p>
                )}
              </EntryNotes>
            </div>
          )}
          {hero === null ? null : (
            // Mounted even in the rows, so Up and Back can focus Play before the block returns. They
            // leave with the title when focus goes down to the rows, and return once the stage is set.
            <div
              className={`relative flex items-center gap-6 transition-opacity ${
                holding && staged
                  ? "ease-curtain opacity-100 duration-[420ms]"
                  : "opacity-0 duration-100 ease-out"
              }`}
            >
              <PlayAction
                focusKey="hero-play"
                label={hero.progress === null ? `Play ${hero.title}` : `Resume ${hero.title}`}
                focusable={holding}
                size="reduced"
                onFocus={lightHero}
                onPress={playHero}
              >
                {hero.progress === null ? "Play" : "Resume"}
              </PlayAction>
              <QuietAction
                focusKey="hero-details"
                label={`Details for ${hero.title}`}
                focusable={holding}
                size="reduced"
                onFocus={lightHero}
                onPress={() => {
                  openEntry(hero);
                }}
              >
                Details
              </QuietAction>
              {next === null ? null : (
                <HeroBar
                  films={featured}
                  current={cycle.index}
                  since={cycle.since}
                  auto={cycle.auto}
                  focusable={holding}
                  onChoose={chooseFilm}
                />
              )}
            </div>
          )}
        </div>
      </section>
    );
  };

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} aria-label="Library" className="relative h-screen w-screen overflow-hidden">
        <Backdrop
          url={
            shown === null || shown.backdrop === null ? null : backdropUrl(server, shown.backdrop)
          }
        />
        <InkField deep={!holding} />

        <CraneMark
          className="top-safe-y left-safe-x absolute block h-[3.25rem] w-auto"
          label="harakiri"
        />
        <div className="right-safe-x absolute top-[calc(var(--spacing-safe-y)-0.5rem)]">
          <SettingsLink />
        </div>

        <LauncherCard />

        {heroPanel()}

        {hero === null || rows === null || rows[0] === undefined ? null : (
          <ScrollCue shown={holding} />
        )}

        {rows === null ? null : <Programme server={server} rows={rows} hero={hero !== null} />}

        {exitSheet}
      </main>
    </FocusContext.Provider>
  );
};
