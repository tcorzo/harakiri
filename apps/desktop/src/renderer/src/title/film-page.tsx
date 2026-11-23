import type { ServerUrl } from "@harakiri/jellyfin";
import { classifyFidelity } from "@harakiri/jellyfin";
import type { BaseItemDto, MediaSourceInfo, MediaStream } from "@harakiri/jellyfin/generated";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { episodeCode, minutesLeft, programmeNotes } from "../data/entry";
import type { Entry } from "../data/entry";
import { Backdrop, backdropUrl, InkField, TitleMark } from "../library/stage";
import { PlayAction, QuietAction } from "../ui/actions";
import { focusFirst } from "../ui/focus";
import { ProgrammeNotes } from "../ui/marks";
import { TrackPicker } from "./track-picker";
import type { TrackOption } from "./track-picker";

/** Jellyfin's index for "no subtitles". */
const subtitlesOff = -1;

const languages = new Intl.DisplayNames(["en"], { type: "language" });

const languageOf = (stream: MediaStream): string => {
  const code = stream.Language;

  if (code === undefined || code === null || code === "" || code === "und") {
    return "Unknown language";
  }

  try {
    return languages.of(code) ?? code;
  } catch {
    return code;
  }
};

/** Sound tracks named the way the programme notes name them: language, then format and channels. */
const audioOptions = (source: MediaSourceInfo | undefined): TrackOption[] =>
  (source?.MediaStreams ?? [])
    .filter(
      (stream) => stream.Type === "Audio" && stream.Index !== undefined && stream.Index !== null
    )
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
        detail: extra,
      };
    });

/** Subtitles by language and purpose; the file format is not a choice anyone makes. */
const subtitleTracks = (streams: readonly MediaStream[]): TrackOption[] =>
  streams.flatMap((stream) => {
    if (stream.Type !== "Subtitle" || stream.Index === undefined || stream.Index === null) {
      return [];
    }

    const flags = [
      stream.IsForced === true ? "Forced" : null,
      stream.IsHearingImpaired === true ? "SDH" : null,
    ].filter((flag) => flag !== null);

    return [
      {
        index: stream.Index,
        label: [languageOf(stream), ...flags].join(" · "),
        detail: stream.IsExternal === true ? "Sidecar file" : undefined,
      },
    ];
  });

/** "Finn the Human (voice)" becomes "Name, voice of Finn the Human", so a comma-separated cast never reads "voice" as another name. */
const creditOf = (name: string, role: string | null | undefined): string => {
  if (role === undefined || role === null || role === "") {
    return name;
  }

  const part = role.replaceAll(/\s*\((?:voice|uncredited)\)/giu, "").trim();

  if (/\(voice\)/iu.test(role)) {
    return `${name}, voice of ${part}`;
  }

  return /\(uncredited\)/iu.test(role) ? `${name} as ${part} (uncredited)` : `${name} as ${part}`;
};

/** The synopsis whole when it fits, otherwise cut at the last sentence that does. */
const synopsis = (text: string | null, max = 420): string => {
  if (text === null) {
    return "No synopsis on the server.";
  }

  if (text.length <= max) {
    return text;
  }

  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));

  return end > 0 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
};

const credits = (item: BaseItemDto) => {
  const people = item.People ?? [];

  return {
    directors: people.filter((p) => p.Type === "Director").map((p) => p.Name ?? ""),
    cast: people
      .filter((p) => p.Type === "Actor")
      .slice(0, 8)
      .map((p) => creditOf(p.Name ?? "", p.Role)),
  };
};

const Credits = ({
  directors,
  cast,
}: {
  readonly directors: readonly string[];
  readonly cast: readonly string[];
}) => (
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
);

type Picking = "none" | "audio" | "subtitle";

export const FilmPage = ({
  entry,
  item,
  server,
}: {
  readonly entry: Entry;
  readonly item: BaseItemDto;
  readonly server: ServerUrl;
}) => {
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

  const play = (start: number): void => {
    void navigate({
      to: "/screening/$id",
      params: { id: entry.id },
      search: audio === null ? { start, subtitle } : { start, audio, subtitle },
    });
  };

  const audioLabel = audioChoices.find((o) => o.index === audio)?.label ?? "Default";
  const subtitleLabel = subtitleOptions.find((o) => o.index === subtitle)?.label ?? "Off";

  const playActions = (): ReactNode => {
    if (source === undefined) {
      // A server entry that is not a film (a box set, a folder) has no file to screen.
      return (
        <p className="text-body text-paper-dim m-0">There is no file to play for this entry.</p>
      );
    }

    if (resumable) {
      return (
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
      );
    }

    return (
      <PlayAction
        focusKey="title-play"
        label={`Play ${entry.title}`}
        onPress={() => {
          play(0);
        }}
      >
        Play
      </PlayAction>
    );
  };

  const picker = (): ReactNode => {
    if (picking === "audio") {
      return (
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
      );
    }

    if (picking === "subtitle") {
      return (
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
      );
    }

    return null;
  };

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
          <div className="flex min-w-0 flex-1 flex-col justify-end gap-8">
            <div className="flex flex-col gap-4">
              <TitleMark entry={entry} server={server} compact={false} />
              {entry.kind === "Episode" ? (
                <p className="text-heading stretch-semicondensed font-[680]">
                  {code === null ? null : <span className="text-paper-dim mr-4">{code}</span>}
                  {entry.title}
                </p>
              ) : null}
              <ProgrammeNotes facts={programmeNotes(entry, fidelity)} seen={entry.played} />
            </div>
            <div className="flex flex-wrap items-center gap-6">
              {playActions()}
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
              <Credits directors={directors} cast={cast} />
            </div>
          </div>
        </div>
        {picker()}
      </main>
    </FocusContext.Provider>
  );
};
