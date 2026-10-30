import { joinFacts, MediaSourceId } from "@harakiri/jellyfin";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { PlayerEvent, PlayRequest, SignalFact, SignalReport } from "../../../shared/bridge";
import { episodeCode, markedState, type Entry } from "../data/entry";
import { classifyFailure } from "../data/errors";
import { catalogueQuery, nextEpisodeQuery, refetchWhenReported, titleQuery } from "../data/queries";
import { useSignedIn } from "../data/session";
import { useActionHandler } from "../input/handlers";
import { inputMode } from "../input/mode";
import { backdropUrl } from "../library/Stage";
import { numberFor } from "../library/sections";
import { PlayAction, QuietAction } from "../ui/actions";
import { focusFirst } from "../ui/focus";
import { catalogueLabel, StateMark } from "../ui/marks";
import { handoffTiming, stationOf, stations, type Station } from "./stations";

const route = getRouteApi("/_signedIn/screening/$id");

type Outcome =
  | { readonly kind: "running" }
  /** Played to its end; mpv has quit, and the next episode, if any, is being looked up. */
  | { readonly kind: "ended" }
  /** The server refused the token (401): the signed-out screen takes over. */
  | { readonly kind: "signedOut"; readonly error: unknown }
  | { readonly kind: "failed"; readonly message: string }
  /** An episode played to its end and the series has another: it is offered, not started. */
  | { readonly kind: "next"; readonly next: Entry };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function StationRule({ current }: { readonly current: Station }) {
  const at = stations.indexOf(current);
  return (
    <ol aria-label="Handoff" className="m-0 flex list-none gap-10 p-0">
      {stations.map((station, i) => (
        <li
          key={station}
          aria-current={station === current ? "step" : undefined}
          className={`flex flex-col gap-2 text-caption font-[620] tracking-[0.1em] uppercase stretch-condensed transition-colors duration-500 ${
            i <= at ? "text-paper" : "text-paper-faint"
          }`}
        >
          <span
            aria-hidden="true"
            className={`block h-[0.1875rem] w-[9rem] ${i <= at ? "bg-paper" : "bg-ink-line"}`}
          />
          {station}
        </li>
      ))}
    </ol>
  );
}

/**
 * The server's own signal path, one fact per leg. A native leg is stated bare; a mapped or
 * decoded leg already says so in words, and its mark repeats that in shape.
 */
export function SignalSlug({ facts }: { readonly facts: readonly SignalFact[] }) {
  const path = joinFacts(facts);
  return (
    <p
      aria-label={`Signal path: ${path}`}
      className="m-0 flex flex-wrap items-baseline gap-x-6 gap-y-3 text-title font-[460] stretch-condensed"
    >
      {facts.map((fact, i) => {
        const state = markedState(fact.state);
        return (
          <span key={fact.text} className="flex items-baseline gap-6">
            {i > 0 ? (
              <span aria-hidden="true" className="text-paper-faint">
                ·
              </span>
            ) : null}
            <span>{fact.text}</span>
            {state === undefined ? null : (
              <span className="self-center text-notes text-paper-dim">
                <StateMark state={state} />
              </span>
            )}
          </span>
        );
      })}
    </p>
  );
}

function Notice({ children }: { readonly children: string }) {
  return (
    <p role="alert" className="m-0 flex max-w-[64ch] items-start gap-4 text-body">
      <span
        aria-hidden="true"
        className="mt-[0.55em] block h-[0.75rem] w-[0.75rem] shrink-0 bg-alert"
      />
      <span>{children}</span>
    </p>
  );
}

/** What the server decided, stated before mpv takes the screen (PRD principle 1). */
export function ServerDecision({ report }: { readonly report: SignalReport }) {
  if (report.unreadable) {
    return (
      <Notice>
        The server could not read this file, so it cannot send it as it is. Check that the server
        can open the file, then rescan the library.
      </Notice>
    );
  }
  if (report.transcodeReasons.length > 0) {
    return (
      <>
        <p className="m-0 text-title font-[460] stretch-condensed">Server transcode</p>
        <Notice>{`The server is converting this file instead of sending it as it is, because: ${report.transcodeReasons.join("; ")}.`}</Notice>
      </>
    );
  }
  if (report.facts.length === 0) {
    return (
      <p className="m-0 text-heading text-paper-dim">The server has not described this file yet.</p>
    );
  }
  return <SignalSlug facts={report.facts} />;
}

function NextEpisode({
  next,
  onPlay,
  onLeave,
}: {
  readonly next: Entry;
  readonly onPlay: () => void;
  readonly onLeave: () => void;
}) {
  const code = episodeCode(next);
  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({ focusKey: "screening-next" });
  useEffect(() => {
    focusFirst("screening-play-next");
  }, []);
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="flex flex-col gap-6">
        <p className="m-0 flex items-baseline gap-6 text-heading font-[620] stretch-semicondensed">
          <span className="text-caption font-[620] tracking-[0.1em] text-paper-dim uppercase stretch-condensed">
            Next
          </span>
          <span>
            {code === null ? null : <span className="mr-4 text-paper-dim">{code}</span>}
            {next.title}
          </span>
        </p>
        <div className="flex gap-6">
          <PlayAction
            focusKey="screening-play-next"
            label={`Play ${code ?? ""} ${next.title}`}
            onPress={onPlay}
          >
            {code === null ? "Play" : `Play ${code}`}
          </PlayAction>
          <QuietAction label="Back to the series" onPress={onLeave} />
        </div>
      </div>
    </FocusContext.Provider>
  );
}

/** The screening handoff: the house dims, the slug states the server's signal path, then mpv takes the screen. */
export function ScreeningScreen() {
  const { id } = route.useParams();
  const search = route.useSearch();
  const ctx = useSignedIn();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(titleQuery(ctx, id));
  const { data: numbers } = useSuspenseQuery(catalogueQuery(ctx));
  const { entry, item } = data;
  const sourceId = item.MediaSources?.[0]?.Id;
  const [request] = useState<PlayRequest>(() => ({
    itemId: id,
    ...(sourceId == null ? {} : { mediaSourceId: MediaSourceId.parse(sourceId) }),
    startPositionTicks: search.start,
    ...(search.audio === undefined ? {} : { audioStreamIndex: search.audio }),
    ...(search.subtitle === undefined ? {} : { subtitleStreamIndex: search.subtitle }),
  }));
  const [houseDone, setHouseDone] = useState(false);
  const [elapsed, setElapsed] = useState<"house" | "slug" | "picture">("house");
  const [report, setReport] = useState<SignalReport | null>(null);
  const [event, setEvent] = useState<PlayerEvent | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "running" });
  const mounted = useRef(true);
  const station = stationOf(elapsed, event);
  const number = numberFor(numbers, entry);
  const { ref, focusKey } = useFocusable<object, HTMLElement>({
    focusKey: "screening",
    trackChildren: true,
    forceFocus: true,
  });

  const fail = (message: string): void => {
    inputMode.getState().setMode("ui");
    setOutcome({ kind: "failed", message });
  };

  /** A token the server refused is not a failed screening: the owner has to sign in again. */
  const failWith = (error: unknown): void => {
    if (classifyFailure(error).kind !== "signedOut") return fail(messageOf(error));
    inputMode.getState().setMode("ui");
    setOutcome({ kind: "signedOut", error });
  };

  /** Before anything played: back where the owner came from. */
  const cancel = (): void => {
    inputMode.getState().setMode("ui");
    router.history.back();
  };

  /** After playback: the title page, which refetches the resume point once the server holds it. */
  const leaveAfterPlayback = (): void => {
    inputMode.getState().setMode("ui");
    if (search.after === "title") {
      void router.navigate({ to: "/title/$id", params: { id }, replace: true });
    } else {
      router.history.back();
    }
  };

  const offerNext = async (): Promise<void> => {
    if (entry.kind !== "Episode" || entry.series === null) return leaveAfterPlayback();
    const next = await queryClient
      .fetchQuery(nextEpisodeQuery(ctx, entry.series.id, entry.id))
      .catch(() => null);
    if (!mounted.current) return;
    if (next === null) leaveAfterPlayback();
    else setOutcome({ kind: "next", next });
  };

  const playNext = (next: Entry): void => {
    void router.navigate({
      to: "/screening/$id",
      params: { id: next.id },
      search: {
        start: next.positionTicks,
        ...(search.after === undefined ? {} : { after: search.after }),
      },
      replace: true,
    });
  };

  const onPlayerEvent = useEffectEvent((next: PlayerEvent) => {
    if (next.itemId !== id) return;
    setEvent(next);
    // The server stores the resume point after these arrive; the refetch waits for `reported`.
    if (next.phase === "stopped" || next.phase === "ended") {
      refetchWhenReported(queryClient, ctx, entry);
    }
    if (next.phase === "stopped") leaveAfterPlayback();
    if (next.phase === "ended") {
      inputMode.getState().setMode("ui");
      setOutcome({ kind: "ended" });
      void offerNext();
    }
    if (next.phase === "error") fail(next.error ?? "The player stopped with an error.");
  });

  const handOff = useEffectEvent(() => {
    setElapsed("picture");
    window.harakiri.player
      .play(request)
      .then(() => {
        // Only now does mpv have the file and the gamepad; until then the renderer keeps it.
        if (mounted.current) inputMode.getState().setMode("player");
      })
      .catch((error: unknown) => {
        if (mounted.current) failWith(error);
      });
  });

  useEffect(() => window.harakiri.player.onEvent((next) => onPlayerEvent(next)), []);

  useEffect(() => {
    mounted.current = true;
    // The server resolves the file while the house dims, so the slug states its decision.
    window.harakiri.player
      .prepare(request)
      .then((decided) => {
        if (mounted.current) setReport(decided);
      })
      .catch((error: unknown) => {
        if (mounted.current) failWith(error);
      });
    const house = window.setTimeout(() => setHouseDone(true), handoffTiming.houseMs);
    return () => {
      mounted.current = false;
      window.clearTimeout(house);
      inputMode.getState().setMode("ui");
    };
    // The request is fixed for the life of this screening.
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  // The programme slug holds once both the house has dimmed and the server has answered.
  const slugReady = houseDone && report !== null && outcome.kind === "running";
  useEffect(() => {
    if (!slugReady) return () => {};
    setElapsed("slug");
    const picture = window.setTimeout(() => handOff(), handoffTiming.slugMs);
    return () => window.clearTimeout(picture);
  }, [slugReady]);

  useEffect(() => {
    if (outcome.kind === "failed") focusFirst("screening-back");
  }, [outcome.kind]);

  // Before the picture starts, Back cancels the screening; once mpv has it, Back asks mpv to stop.
  // Once the file has ended, mpv is gone and Back leaves.
  useActionHandler("back", () => {
    if (outcome.kind === "next" || outcome.kind === "ended") leaveAfterPlayback();
    else if (outcome.kind === "failed" || elapsed !== "picture") cancel();
    else void window.harakiri.player.stop().catch(() => leaveAfterPlayback());
  });

  // The route's error screen says the server signed this device out and offers to sign in again.
  if (outcome.kind === "signedOut") throw outcome.error;

  const name = entry.kind === "Episode" && entry.series !== null ? entry.series.name : entry.title;
  const code = episodeCode(entry);

  return (
    <FocusContext.Provider value={focusKey}>
      <main
        ref={ref}
        aria-label={`Screening ${entry.title}`}
        data-station={station}
        className="relative h-screen w-screen overflow-hidden bg-house"
      >
        {entry.backdrop === null ? null : (
          <img
            alt=""
            aria-hidden="true"
            src={backdropUrl(ctx.server, entry.backdrop)}
            className="absolute inset-0 h-full w-full object-cover transition-[filter,opacity] ease-house"
            style={{
              transitionDuration: `${handoffTiming.houseMs}ms`,
              filter:
                station === "House" && !houseDone
                  ? "brightness(0.5)"
                  : "brightness(0.08) saturate(0.4)",
              opacity: station === "Picture" ? 0 : 1,
            }}
          />
        )}
        <div className="absolute inset-x-safe-x top-safe-y bottom-safe-y flex flex-col justify-between">
          <StationRule current={station} />
          <div
            className="flex flex-col gap-10 transition-[opacity,transform] duration-700 ease-curtain"
            style={{
              opacity: elapsed === "house" ? 0 : 1,
              transform: elapsed === "house" ? "translateY(1.5rem)" : "none",
            }}
          >
            <div className="flex items-baseline gap-8">
              {number === null ? null : (
                <span className="shrink-0 text-heading font-[300] whitespace-nowrap text-paper-dim stretch-condensed">
                  {catalogueLabel(number)}
                </span>
              )}
              <h1 className="m-0 text-marquee font-[820] text-balance stretch-extra-wide">
                {name}
              </h1>
            </div>
            {entry.kind === "Episode" ? (
              <p className="m-0 text-heading font-[620] stretch-semicondensed">
                {code} {entry.title}
              </p>
            ) : null}
            {/* Once an episode has ended, the screen is about what comes next, not the file that played. */}
            {report === null || outcome.kind === "next" ? null : <ServerDecision report={report} />}
          </div>
          <div className="flex min-h-[5rem] items-end justify-between">
            {outcome.kind === "failed" ? (
              <div className="flex flex-col gap-6">
                <p role="alert" className="m-0 max-w-[64ch] text-body">
                  It did not start. {outcome.message}
                </p>
                <div>
                  <QuietAction
                    focusKey="screening-back"
                    label="Back to the programme"
                    onPress={cancel}
                  />
                </div>
              </div>
            ) : outcome.kind === "next" ? (
              <NextEpisode
                next={outcome.next}
                onPlay={() => playNext(outcome.next)}
                onLeave={leaveAfterPlayback}
              />
            ) : outcome.kind === "ended" ? (
              <p aria-live="polite" className="m-0 text-body text-paper-dim">
                Played to the end. Press Back to leave.
              </p>
            ) : station === "Picture" ? (
              <p aria-live="polite" className="m-0 text-body text-paper-dim">
                Now screening in the player. Press Back to stop.
              </p>
            ) : (
              <p className="m-0 text-body text-paper-faint">Press Back to cancel.</p>
            )}
          </div>
        </div>
      </main>
    </FocusContext.Provider>
  );
}
