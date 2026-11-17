import type { ServerUrl } from "@harakiri/jellyfin";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useRef } from "react";
import type { ComponentType, ReactNode } from "react";

import type { Entry } from "../data/entry";
import { QuietAction } from "../ui/actions";
import { Notice, rootRem, SectionHead } from "../ui/marks";
import type { CardProps } from "./cards";
import { useReducedMotion } from "./hero-cycle";
import { cardKey, rowKey, useLit } from "./lit";
import type { Section } from "./lit";
import { numberFor } from "./sections";

export interface ProgrammeRowProps {
  readonly sectionId: string;
  readonly sectionName: string;
  readonly entries: readonly Entry[];
  readonly Card: ComponentType<CardProps>;
  /** Card width plus the gap, in rem. */
  readonly pitchRem: number;
  readonly heightRem: number;
  readonly server: ServerUrl;
  readonly numbers: ReadonlyMap<string, number>;
  readonly onFocusEntry: (entry: Entry, section: Section) => void;
  readonly onPressEntry: (entry: Entry) => void;
}

const gapRem = 2;

function RowHeader({ name, children }: { readonly name: string; readonly children: ReactNode }) {
  return (
    <header className="pr-safe-x flex h-[3rem] items-center gap-6">
      <SectionHead>{name}</SectionHead>
      <span aria-hidden="true" className="hairline h-0 flex-1 border-t-2" />
      {children}
    </header>
  );
}

/**
 * One programme section: a section head, a hairline, and a horizontally virtualized run of entries.
 * Memoized, with primitive and stable props, so moving between rows re-renders none of them.
 */
export const ProgrammeRow = memo(
  ({
    sectionId,
    sectionName,
    entries,
    Card,
    pitchRem,
    heightRem,
    server,
    numbers,
    onFocusEntry,
    onPressEntry,
  }: ProgrammeRowProps) => {
    const { ref, focusKey } = useFocusable<object, HTMLElement>({
      focusKey: rowKey(sectionId),
      saveLastFocusedChild: true,
    });

    const scroller = useRef<HTMLDivElement>(null);
    const rem = rootRem();

    // No React Compiler in this build, so the virtualizer's unmemoizable API is fine.
    // oxlint-disable-next-line react/incompatible-library
    const virtualizer = useVirtualizer({
      horizontal: true,
      count: entries.length,
      getScrollElement: () => scroller.current,
      estimateSize: () => (pitchRem - gapRem) * rem,
      gap: gapRem * rem,
      // Norigin only sees mounted cards, so keep neighbours mounted in the direction of travel.
      overscan: 4,
      // Room for the focused card's scale and ring at the row's leading edge.
      paddingStart: 1.5 * rem,
      scrollPaddingStart: 1.5 * rem,
      initialRect: { width: window.innerWidth, height: 400 },
      // Returning from a title page reopens the row on the card the owner left, wherever it moved.
      initialOffset: () => {
        const { place } = useLit.getState();

        if (place?.section !== sectionId) {
          return 0;
        }
        const at = entries.findIndex((entry) => entry.id === place.entry);

        return at === -1 ? 0 : at * pitchRem * rem;
      },
    });

    const reduced = useReducedMotion();
    const section: Section = { id: sectionId, name: sectionName };

    return (
      <FocusContext.Provider value={focusKey}>
        <section ref={ref} aria-label={sectionName} className="flex flex-col gap-5">
          <RowHeader name={sectionName}>
            <span className="text-caption text-paper-dim stretch-condensed font-[600]">
              {entries.length} {entries.length === 1 ? "title" : "titles"}
            </span>
          </RowHeader>
          <div ref={scroller} className="pr-safe-x -ml-6 overflow-x-hidden py-6">
            <div
              className="relative"
              style={{ width: virtualizer.getTotalSize(), height: `${heightRem}rem` }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const entry = entries[item.index];

                if (entry === undefined) {
                  return null;
                }

                return (
                  <div
                    key={entry.id}
                    className="absolute top-0 left-0"
                    style={{ transform: `translateX(${item.start}px)` }}
                  >
                    <Card
                      entry={entry}
                      number={numberFor(numbers, entry)}
                      server={server}
                      focusKey={cardKey(sectionId, entry.id)}
                      onFocus={() => {
                        virtualizer.scrollToIndex(item.index, {
                          align: "start",
                          behavior: reduced ? "auto" : "smooth",
                        });
                        onFocusEntry(entry, section);
                      }}
                      onPress={() => {
                        onPressEntry(entry);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </FocusContext.Provider>
    );
  }
);

/** Focus key of a failed section's retry, the one thing in it the d-pad can reach. */
export const retryKey = (sectionId: string): string => `retry|${sectionId}`;

/** A section whose request failed: the rest of the programme still shows, and this one can retry. */
export const FailedRow = memo(
  ({
    sectionId,
    sectionName,
    onRetry,
  }: {
    readonly sectionId: string;
    readonly sectionName: string;
    readonly onRetry: () => void;
  }) => {
    const { ref, focusKey } = useFocusable<object, HTMLElement>({ focusKey: rowKey(sectionId) });

    return (
      <FocusContext.Provider value={focusKey}>
        <section ref={ref} aria-label={sectionName} className="flex flex-col gap-5">
          <RowHeader name={sectionName}>{null}</RowHeader>
          <div className="pr-safe-x flex items-center gap-8 py-6">
            <Notice>This section did not load from the server.</Notice>
            <QuietAction
              focusKey={retryKey(sectionId)}
              label={`Try ${sectionName} again`}
              onPress={onRetry}
            >
              Try again
            </QuietAction>
          </div>
        </section>
      </FocusContext.Provider>
    );
  }
);
