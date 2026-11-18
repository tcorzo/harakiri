import { ItemId } from "@harakiri/jellyfin";
import type { ServerUrl } from "@harakiri/jellyfin";
import {
  FocusContext,
  getCurrentFocusKey,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import { useQueries, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { ComponentType } from "react";
import { preload } from "react-dom";

import { imageUrl } from "../data/entry";
import type { Entry } from "../data/entry";
import {
  catalogueQuery,
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
import { PlayAction, QuietAction } from "../ui/actions";
import { focusFirst } from "../ui/focus";
import { catalogueLabel, remPx } from "../ui/marks";
import { PosterCard, StillCard } from "./cards";
import type { CardProps } from "./cards";
import { heroHoldMs, upNext, useHeroCycle } from "./heroCycle";
import { cardKey, restoreKeys, tonight, useLit } from "./lit";
import type { Section } from "./lit";
import { FailedRow, ProgrammeRow, retryKey } from "./ProgrammeRow";
import { numberFor } from "./sections";
import { Backdrop, backdropUrl, EntryNotes, InkField, Margin, TitleMark } from "./Stage";

const noItem = ItemId.parse("00000000000000000000000000000000");

interface RowShape {
  readonly Card: ComponentType<CardProps>;
  readonly pitchRem: number;
  readonly heightRem: number;
}

const still: RowShape = { Card: StillCard, pitchRem: 26, heightRem: 19.5 };
const poster: RowShape = { Card: PosterCard, pitchRem: 15.5, heightRem: 26 };

/** A failed section holds one line and its retry action. */
const failedHeightRem = 4.5;

/** Header, padding and the gap to the next section, around each row's cards (rem). */
const rowChromeRem = 3 + 1.25 + 3 + 3;

/** Where the focused row's top edge rests once focus leaves the hero (rem from the top). */
const rowAnchorRem = 31;

/** How much of the first row shows under the hero. */
const peekRem = 9.5;

type PlannedRow =
  | ({
      readonly kind: "entries";
      readonly section: Section;
      readonly entries: readonly Entry[];
    } & RowShape)
  | {
      readonly kind: "failed";
      readonly section: Section;
      readonly heightRem: number;
      readonly retry: () => void;
    };

const failed = (section: Section, refetch: () => unknown): PlannedRow => ({
  kind: "failed",
  section,
  heightRem: failedHeightRem,
  retry: () => void refetch(),
});

/**
 * The programme rows, each from its own request. A failed request becomes a failed row with its
 * own retry, so one bad section never takes the library down. Null until every request settles,
 * so the rows appear together rather than shifting under the owner's focus.
 */
function useProgramme(): readonly PlannedRow[] | null {
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
    query: { readonly data: readonly Entry[] | undefined; readonly refetch: () => unknown },
    shape: RowShape
  ): void => {
    if (query.data === undefined) {
      rows.push(failed(section, query.refetch));
    } else if (query.data.length > 0) {
      rows.push({ kind: "entries", section, entries: query.data, ...shape });
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
}

function rowTop(rows: readonly PlannedRow[], index: number): number {
  let top = 0;

  for (const row of rows.slice(0, Math.max(0, index - 1))) {
    top += row.heightRem + rowChromeRem;
  }

  return top;
}

const relightRestMs = 180;
let relightTimer = 0;

function useOpenEntry(): (entry: Entry) => void {
  const navigate = useNavigate();

  return useCallback(
    (entry: Entry) => void navigate({ to: "/title/$id", params: { id: entry.id } }),
    [navigate]
  );
}

const Programme = memo(
  ({
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
    const { data: numbers } = useSuspenseQuery(catalogueQuery(ctx));
    const activeId = useLit((s) => s.section.id);
    const travelling = useLit((s) => s.travelling);
    const found = rows.findIndex((row) => row.section.id === activeId) + 1;
    // With no featured film there is no stage to rest on, so the first row leads.
    const active = found === 0 && !hero ? 1 : found;

    const offset =
      active === 0 ? `calc(100vh - ${peekRem}rem)` : `${rowAnchorRem - rowTop(rows, active)}rem`;

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
          void queryClient.prefetchQuery(rawItemQuery(ctx, entry.id));

          if (entry.kind === "Series") {
            void queryClient.prefetchQuery(seasonsQuery(ctx, entry.id));
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

      if (place !== null || !hero) {
        focusFirst(...restoreKeys(place, hero, first));
      }
    }, [hero, first]);

    return (
      <div
        // A held d-pad moves a row every 120 ms, faster than the 700 ms glide, so while it travels the
        // rows jump with focus and the glide returns once it rests (the relight ends the travel).
        className={`ease-curtain absolute inset-x-0 top-0 flex flex-col gap-12 pl-[calc(var(--spacing-safe-x)+var(--spacing-margin)+2.5rem)] ${
          travelling ? "" : "transition-transform duration-700"
        }`}
        style={{ transform: `translateY(${offset})` }}
      >
        {rows.map((row, i) => (
          <div
            key={row.section.id}
            // Rows waiting below dim their pictures only; their type keeps full contrast.
            className={`transition-opacity duration-500 [&_img]:transition-opacity [&_img]:duration-500 ${
              i + 1 < active ? "opacity-0" : "opacity-100"
            } ${i + 1 > active && active !== 0 ? "[&_img]:opacity-50" : ""}`}
          >
            {row.kind === "failed" ? (
              <FailedRow
                sectionId={row.section.id}
                sectionName={row.section.name}
                onRetry={row.retry}
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
                numbers={numbers}
                onFocusEntry={onFocusEntry}
                onPressEntry={onPressEntry}
              />
            )}
          </div>
        ))}
      </div>
    );
  }
);

function UpNext({
  entry,
  number,
  since,
  auto,
  focusable,
  server,
  onPress,
}: {
  readonly entry: Entry;
  readonly number: number | null;
  readonly since: number;
  readonly auto: boolean;
  readonly focusable: boolean;
  readonly server: ServerUrl;
  readonly onPress: () => void;
}) {
  const { ref } = useFocusable<object, HTMLButtonElement>({ focusKey: "hero-next", focusable });

  return (
    <button
      ref={ref}
      type="button"
      aria-label={`Next screening: ${entry.title}`}
      tabIndex={focusable ? undefined : -1}
      onClick={onPress}
      className="group focus-mark flex w-[22rem] flex-col gap-3 text-left"
    >
      {entry.still === null ? null : (
        <img
          alt=""
          src={imageUrl(server, entry.still, 22 * remPx())}
          className="aspect-video w-full object-cover opacity-80 group-focus-visible:opacity-100"
        />
      )}
      <span className="text-body stretch-semicondensed truncate font-[700]">{entry.title}</span>
      <span className="text-caption text-paper-dim stretch-condensed flex items-baseline justify-between gap-4 font-[560] whitespace-nowrap">
        <span>{auto ? `Next in ${heroHoldMs / 1000} quiet seconds` : "Next screening"}</span>
        {number === null ? null : <span>{catalogueLabel(number)}</span>}
      </span>
      <span aria-hidden="true" className="bg-ink-line block h-[0.1875rem] w-full">
        {auto ? (
          <span
            key={since}
            className="animate-hold bg-paper block h-full origin-left"
            style={{ animationDuration: `${heroHoldMs}ms` }}
          />
        ) : null}
      </span>
    </button>
  );
}

function SettingsLink() {
  const navigate = useNavigate();
  const { ref } = useFocusable<object, HTMLButtonElement>({ focusKey: "library-settings" });

  return (
    <button
      ref={ref}
      type="button"
      aria-label="Settings"
      onClick={() => void navigate({ to: "/settings" })}
      // Full paper, not dim: it sits on the thin top wash, over whatever the backdrop's sky is.
      className="focus-mark text-body text-paper stretch-semicondensed focus-visible:bg-paper focus-visible:text-ink px-4 py-2 font-[600]"
    >
      Settings
    </button>
  );
}

function EmptyLibrary() {
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
}

export function LibraryScreen() {
  const ctx = useSignedIn();
  const { server, session } = ctx;
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
  const { data: numbers } = useSuspenseQuery(catalogueQuery(ctx));

  const { ref, focusKey } = useFocusable<object, HTMLElement>({
    focusKey: "library",
    trackChildren: true,
    // A press with nothing focused (a key that went away) recovers here instead of doing nothing.
    forceFocus: true,
  });

  useActionHandler("menu", () => void navigate({ to: "/settings" }));
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
    focusFirst("hero-play");
  }, []);

  if (next?.backdrop != null) {
    preload(backdropUrl(server, next.backdrop), { as: "image" });
  }

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

  const number = shown === null ? null : numberFor(numbers, shown);

  return (
    <FocusContext.Provider value={focusKey}>
      <main ref={ref} aria-label="Library" className="relative h-screen w-screen overflow-hidden">
        <Backdrop
          url={
            shown === null || shown.backdrop === null ? null : backdropUrl(server, shown.backdrop)
          }
        />
        <InkField deep={!holding} />

        <div className="top-safe-y left-safe-x absolute flex items-baseline gap-4">
          <span className="text-heading stretch-extra-wide font-[820]">harakiri</span>
          <span className="text-caption text-paper-dim stretch-condensed">
            {session.serverName}
          </span>
        </div>
        <div className="right-safe-x absolute top-[calc(var(--spacing-safe-y)-0.5rem)]">
          <SettingsLink />
        </div>

        {shown === null ? null : (
          <section
            aria-label={holding ? "Tonight's screening" : shown.title}
            className="left-safe-x ease-curtain absolute flex items-stretch gap-10 transition-transform duration-700"
            style={{
              bottom: `${peekRem + 3}rem`,
              // Lifts the block so its last visible line rests just above the focused row.
              transform: holding
                ? "none"
                : `translateY(calc(${rowAnchorRem + 4.25 + peekRem + 3}rem - 100vh))`,
            }}
          >
            <Margin number={number} seen={shown.played} section={section.name} />
            <div className="flex max-w-[46vw] flex-col justify-end gap-7">
              <TitleMark entry={shown} server={server} compact={!holding} />
              <EntryNotes entry={shown}>
                {holding || shown.overview === null ? null : (
                  <p className="text-body text-paper-dim line-clamp-2 max-w-[60ch]">
                    {shown.overview}
                  </p>
                )}
              </EntryNotes>
              {hero === null ? null : (
                <div
                  className={`flex items-center gap-6 transition-opacity duration-500 ${holding ? "opacity-100" : "opacity-0"}`}
                >
                  <PlayAction
                    focusKey="hero-play"
                    label={hero.progress === null ? `Play ${hero.title}` : `Resume ${hero.title}`}
                    focusable={holding}
                    onFocus={lightHero}
                    onPress={playHero}
                  >
                    {hero.progress === null ? "Play" : "Resume"}
                  </PlayAction>
                  <QuietAction
                    focusKey="hero-programme"
                    label={`Programme notes for ${hero.title}`}
                    focusable={holding}
                    onFocus={lightHero}
                    onPress={() => {
                      openEntry(hero);
                    }}
                  >
                    Programme
                  </QuietAction>
                </div>
              )}
            </div>
          </section>
        )}

        {next === null ? null : (
          <div
            className={`right-safe-x absolute transition-opacity duration-500 ${holding ? "opacity-100" : "opacity-0"}`}
            style={{ bottom: `${peekRem + 3}rem` }}
          >
            <UpNext
              entry={next}
              number={numberFor(numbers, next)}
              since={cycle.since}
              auto={cycle.auto}
              focusable={holding}
              server={server}
              onPress={cycle.next}
            />
          </div>
        )}

        {rows === null ? null : <Programme server={server} rows={rows} hero={hero !== null} />}
      </main>
    </FocusContext.Provider>
  );
}
