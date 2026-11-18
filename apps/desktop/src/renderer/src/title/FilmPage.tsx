import type { ServerUrl } from "@harakiri/jellyfin";
import { classifyFidelity } from "@harakiri/jellyfin";
import type { BaseItemDto, MediaSourceInfo, MediaStream } from "@harakiri/jellyfin/generated";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { episodeCode, minutesLeft, programmeNotes } from "../data/entry";
import type { Entry } from "../data/entry";
import { Backdrop, backdropUrl, InkField, Margin, TitleMark } from "../library/Stage";
import { PlayAction, QuietAction } from "../ui/actions";
import { focusFirst } from "../ui/focus";
import { ProgrammeNotes } from "../ui/marks";
import { TrackPicker } from "./TrackPicker";
import type { TrackOption } from "./TrackPicker";

/** Jellyfin's index for "no subtitles". */
const subtitlesOff = -1;

const languages = new Intl.DisplayNames(["en"], { type: "language" });

function languageOf(stream: MediaStream): string {
  const code = stream.Language;

  if (code == null || code === "" || code === "und") {
    return "Unknown language";
  }

  try {
    return languages.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Sound tracks named the way the programme notes name them: language, then format and channels. */
function audioOptions(source: MediaSourceInfo | undefined): TrackOption[] {
  return (source?.MediaStreams ?? [])
    .filter((stream) => stream.Type === "Audio" && stream.Index != null)
    .map((stream) => {
      const index = stream.Index ?? 0;
      const sound = classifyFidelity(source, { audioStreamIndex: index })?.sound ?? null;

      const format =
        sound === null
          ? null
          : [sound.format === "Other" ? sound.codec.toUpperCase() : sound.format, sound.channels]
              .filter((part) => part !== null)
              .join(" ");

      const extra = stream.IsDefault === true ? "Default" : (stream.Title ?? undefined);

      return {
        index,
        label: [languageOf(stream), format].filter((part) => part !== null).join(" · "),
        ...(extra === undefined ? {} : { detail: extra }),
      };
    });
}

/** Subtitles by language and purpose; the file format is not a choice anyone makes. */
function subtitleTracks(streams: readonly MediaStream[]): TrackOption[] {
  return streams
    .filter((stream) => stream.Type === "Subtitle" && stream.Index != null)
    .map((stream) => {
      const flags = [
        stream.IsForced === true ? "Forced" : null,
        stream.IsHearingImpaired === true ? "SDH" : null,
      ].filter((flag) => flag !== null);

      return {
        index: stream.Index ?? 0,
        label: [languageOf(stream), ...flags].join(" · "),
        ...(stream.IsExternal === true ? { detail: "Sidecar file" } : {}),
      };
    });
}

/** "Finn the Human (voice)" becomes "Name, voice of Finn the Human", so a comma-separated cast never reads "voice" as another name. */
function creditOf(name: string, role: string | null | undefined): string {
  if (role == null || role === "") {
    return name;
  }
  const part = role.replaceAll(/\s*\((voice|uncredited)\)/gi, "").trim();

  if (/\(voice\)/i.test(role)) {
    return `${name}, voice of ${part}`;
  }

  return /\(uncredited\)/i.test(role) ? `${name} as ${part} (uncredited)` : `${name} as ${part}`;
}

/** The synopsis whole when it fits, otherwise cut at the last sentence that does. */
function synopsis(text: string | null, max = 420): string {
  if (text === null) {
    return "No synopsis on the server.";
  }

  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));

  return end > 0 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

function credits(item: BaseItemDto): { directors: string[]; cast: string[] } {
  const people = item.People ?? [];

  return {
    directors: people.filter((p) => p.Type === "Director").map((p) => p.Name ?? ""),
    cast: people
      .filter((p) => p.Type === "Actor")
      .slice(0, 8)
      .map((p) => creditOf(p.Name ?? "", p.Role)),
  };
}

type Picking = "none" | "audio" | "subtitle";

export function FilmPage({
  entry,
  item,
  number,
  server,
}: {
  readonly entry: Entry;
  readonly item: BaseItemDto;
  readonly number: number | null;
  readonly server: ServerUrl;
}) {
  const navigate = useNavigate();
  const source = item.MediaSources?.[0];
  const streams = source?.MediaStreams ?? [];
  const audioChoices = audioOptions(source);

  const subtitleOptions: TrackOption[] = [
    { index: subtitlesOff, label: "Off" },
    ...subtitleTracks(streams),
  ];

  const [audio, setAudio] = useState<number | null>(entry.fidelity?.sound?.streamIndex ?? null);

  const [subtitle, setSubtitle] = useState<number>(
    source?.DefaultSubtitleStreamIndex ?? subtitlesOff
  );

  const [picking, setPicking] = useState<Picking>("none");
  const fidelity = classifyFidelity(source, audio === null ? {} : { audioStreamIndex: audio });

  const { ref, focusKey } = useFocusable<object, HTMLElement>({
    focusKey: "title-page",
    trackChildren: true,
    forceFocus: true,
  });

  const resumable = entry.progress !== null;
  const left = minutesLeft(entry);
  const code = episodeCode(entry);
  const { directors, cast } = credits(item);

  useEffect(() => {
    focusFirst("title-play", "title-subtitles");
  }, []);

  // Closing the sheet unmounts the focused track, so focus goes back to the button that opened it.
  const closePicker = (opener: string): void => {
    setPicking("none");
    focusFirst(opener, "title-play");
  };

  const play = (start: number): void =>
    void navigate({
      to: "/screening/$id",
      params: { id: entry.id },
      search: {
        start,
        ...(audio === null ? {} : { audio }),
        subtitle,
      },
    });

  const audioLabel = audioChoices.find((o) => o.index === audio)?.label ?? "Default";
  const subtitleLabel = subtitleOptions.find((o) => o.index === subtitle)?.label ?? "Off";

  return (
    <FocusContext.Provider value={focusKey}>
      <main
        ref={ref}
        aria-label={entry.title}
        className="relative h-screen w-screen overflow-hidden"
      >
        <Backdrop url={entry.backdrop === null ? null : backdropUrl(server, entry.backdrop)} />
        <InkField deep />
        <div className="inset-x-safe-x bottom-safe-y absolute top-[calc(var(--spacing-safe-y)+5rem)] flex gap-10">
          <Margin
            number={number}
            seen={entry.played}
            section={entry.kind === "Episode" ? "Episode" : "Programme"}
          />
          <div className="flex min-w-0 flex-1 flex-col justify-end gap-8">
            <div className="flex flex-col gap-4">
              <TitleMark entry={entry} server={server} compact={false} />
              {entry.kind === "Episode" ? (
                <p className="text-heading stretch-semicondensed font-[680]">
                  {code === null ? null : <span className="text-paper-dim mr-4">{code}</span>}
                  {entry.title}
                </p>
              ) : null}
              <ProgrammeNotes facts={programmeNotes(entry, fidelity)} />
            </div>
            <div className="flex flex-wrap items-center gap-6">
              {source === undefined ? (
                // A server entry that is not a film (a box set, a folder) has no file to screen.
                <p className="text-body text-paper-dim m-0">
                  There is no file to play for this entry.
                </p>
              ) : resumable ? (
                <>
                  <PlayAction
                    focusKey="title-play"
                    label={`Resume ${entry.title}`}
                    onPress={() => {
                      play(entry.positionTicks);
                    }}
                  >
                    Resume{left === null ? "" : ` · ${left} min left`}
                  </PlayAction>
                  <QuietAction
                    label="Play from the start"
                    onPress={() => {
                      play(0);
                    }}
                  >
                    From the start
                  </QuietAction>
                </>
              ) : (
                <PlayAction
                  focusKey="title-play"
                  label={`Play ${entry.title}`}
                  onPress={() => {
                    play(0);
                  }}
                >
                  Play
                </PlayAction>
              )}
              {audioChoices.length > 1 ? (
                <QuietAction
                  focusKey="title-sound"
                  label={`Sound: ${audioLabel}`}
                  onPress={() => {
                    setPicking("audio");
                  }}
                >
                  <span className="text-paper-dim">Sound</span>
                  <span className="max-w-[22rem] truncate">{audioLabel}</span>
                </QuietAction>
              ) : null}
              {source === undefined ? null : (
                <QuietAction
                  focusKey="title-subtitles"
                  label={`Subtitles: ${subtitleLabel}`}
                  onPress={() => {
                    setPicking("subtitle");
                  }}
                >
                  <span className="text-paper-dim">Subtitles</span>
                  <span className="max-w-[18rem] truncate">{subtitleLabel}</span>
                </QuietAction>
              )}
            </div>
            <div className="grid grid-cols-[minmax(0,62ch)_minmax(0,1fr)] gap-16">
              <p className="text-body text-paper-dim m-0 self-start">{synopsis(entry.overview)}</p>
              <dl className="text-body m-0 flex flex-col gap-3">
                {directors.length > 0 ? (
                  <div className="flex gap-4">
                    <dt className="text-caption text-paper-dim stretch-condensed w-[7rem] shrink-0 font-[620] tracking-[0.1em] uppercase">
                      Directed
                    </dt>
                    <dd className="stretch-semicondensed m-0">{directors.join(", ")}</dd>
                  </div>
                ) : null}
                {cast.length > 0 ? (
                  <div className="flex gap-4">
                    <dt className="text-caption text-paper-dim stretch-condensed w-[7rem] shrink-0 font-[620] tracking-[0.1em] uppercase">
                      With
                    </dt>
                    <dd className="stretch-semicondensed m-0 line-clamp-4">{cast.join(", ")}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>
        </div>
        {picking === "audio" ? (
          <TrackPicker
            title="Sound"
            options={audioChoices}
            chosen={audio ?? -2}
            onChoose={(index) => {
              setAudio(index);
              closePicker("title-sound");
            }}
            onClose={() => {
              closePicker("title-sound");
            }}
          />
        ) : picking === "subtitle" ? (
          <TrackPicker
            title="Subtitles"
            options={subtitleOptions}
            chosen={subtitle}
            onChoose={(index) => {
              setSubtitle(index);
              closePicker("title-subtitles");
            }}
            onClose={() => {
              closePicker("title-subtitles");
            }}
          />
        ) : null}
      </main>
    </FocusContext.Provider>
  );
}
