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
import { PosterCard, StillCard } from "./cards";
import type { CardProps } from "./cards";
import { heroHoldMs, upNext, useHeroCycle } from "./hero-cycle";
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

const still: RowLayout = { Card: StillCard, pitchRem: 26, heightRem: 19.5 };
const poster: RowLayout = { Card: PosterCard, pitchRem: 15.5, heightRem: 26 };

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
    layout: RowLayout
  ): void => {
    if (query.data === undefined) {
      rows.push(failed(section, query.refetch));
    } else if (query.data.length > 0) {
      rows.push({ kind: "entries", section, entries: query.data, ...layout });
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
          ...poster,
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

  // Up from the first row returns to the stage, which the spatial search cannot see while it is hidden.
  const first = rows[0]?.section.id;
  useNavigationGuard((direction) => {
    if (direction !== "up" || !hero || first === undefined) {
      return false;
    }

    // Typed as a string, but null while nothing has focus.
    const key: string | null = getCurrentFocusKey();

    if (key === null) {
      return false;
    }

    if (!key.startsWith(cardKey(first, "")) && key !== retryKey(first)) {
      return false;
    }

    return focusFirst("hero-play");
  });

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
 * How long tonight's screening holds before the next featured film takes the stage: a paper rule
 * across the content width, in the gap between the hero and the first row, that fills over the
 * quiet hold and starts again on any press.
 */
const HoldRule = ({ since, auto }: { readonly since: number; readonly auto: boolean }) => (
  <div
    aria-hidden="true"
    className="absolute -bottom-6 left-0 w-[calc(100vw-2*var(--spacing-safe-x))]"
  >
    <span className="bg-ink-line block h-[0.1875rem]">
      {auto ? (
        <span
          key={since}
          className="animate-hold bg-paper block h-full origin-left"
          style={{ animationDuration: `${heroHoldMs}ms` }}
        />
      ) : null}
    </span>
  </div>
);

/**
 * While the hero holds the full screen, the rows wait out of sight; one thin arrow, drifting
 * slowly, says there is more below. Down on the d-pad reaches it, so the cue never takes focus.
 */
const ScrollCue = ({ shown }: { readonly shown: boolean }) => (
  <div
    aria-hidden="true"
    className={`bottom-safe-y text-paper-dim absolute left-1/2 -translate-x-1/2 transition-opacity duration-500 ${
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

const EmptyLibrary = () => {
  useEffect(() => {
    focusFirst("library-settings");
  }, []);

  return (
    <main className="px-safe-x py-safe-y flex h-screen flex-col justify-end gap-6">
      <h1 className="text-marquee stretch-extra-wide m-0 font-[820]">An empty programme</h1>
      <p className="text-body text-paper-dim max-w-[60ch]">
        The server has no films or series this account can see yet. Add a library on the server, let
        it scan, then come back.
      </p>
      <div>
        <SettingsLink />
      </div>
    </main>
  );
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
  // Back from the rows returns to tonight's screening rather than leaving the app.
  useActionHandler("back", () => {
    if (!holding && hero !== null) {
      focusFirst("hero-play");
    }
  });

  useEffect(() => {
    if (useLit.getState().place !== null) {
      return;
    }

    useLit.setState({ entry: null, section: tonight });
    // A card drawn from a cached status registers in this same render, before this effect runs.
    focusFirst(launcherAddKey, "hero-play");
  }, []);

  preloadBackdrop(server, next);

  if (hero === null && rows !== null && rows.length === 0) {
    return <EmptyLibrary />;
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
          // The block changes only while it is out: it leaves fast, and returns on the curtain ease.
          className={`flex w-[calc(100vw-2*var(--spacing-safe-x))] flex-col gap-7 transition-opacity ${
            visible
              ? "ease-curtain opacity-100 duration-[420ms]"
              : "opacity-0 duration-100 ease-out"
          } ${staged ? "items-center text-center" : "items-start text-left"}`}
        >
          {face === null ? null : (
            <>
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
            </>
          )}
          {hero === null ? null : (
            // Mounted even in the rows, so Up and Back can focus Play before the block returns.
            <div className={`flex items-center gap-6 ${staged ? "opacity-100" : "opacity-0"}`}>
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
              {next === null ? null : <HoldRule since={cycle.since} auto={cycle.auto} />}
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
      </main>
    </FocusContext.Provider>
  );
};
