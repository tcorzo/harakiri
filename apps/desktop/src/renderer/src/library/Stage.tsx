import type { ServerUrl } from "@harakiri/jellyfin";
import { useState, type ReactNode } from "react";
import { imageUrl, programmeNotes, type Entry, type ImageRef } from "../data/entry";
import { ProgrammeNotes, SeenMark } from "../ui/marks";

export function backdropUrl(server: ServerUrl, image: ImageRef): string {
  return imageUrl(
    server,
    image,
    Math.min(3840, window.screen.width * (window.devicePixelRatio || 1)),
  );
}

/** Cross-fades from the previous backdrop to the new one so a re-light never flashes to black. */
export function Backdrop({ url }: { readonly url: string | null }) {
  const [layers, setLayers] = useState<readonly (string | null)[]>([url]);
  if (layers.at(-1) !== url) setLayers([layers.at(-1) ?? null, url]);
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-ink">
      {layers.map((layer, i) =>
        layer === null ? null : (
          <img
            key={layer}
            alt=""
            src={layer}
            decoding="async"
            fetchPriority={i === layers.length - 1 ? "high" : "auto"}
            className={`absolute inset-0 h-full w-full object-cover object-top ${
              i === layers.length - 1 && layers.length > 1 ? "animate-relight" : ""
            }`}
          />
        ),
      )}
    </div>
  );
}

/** The programme-ink field that owns the lower two thirds and the margin side of the frame. */
export function InkField({ deep }: { readonly deep: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 transition-opacity duration-700 ease-curtain"
      style={{
        // An eased ramp rather than a hard stop, so a bright backdrop fades into the ink instead of
        // ending on a horizon line; the thin top band keeps the wordmark and Settings legible.
        background: deep
          ? "linear-gradient(to top, var(--color-ink) 0%, var(--color-ink) 35%, color-mix(in oklch, var(--color-ink) 85%, transparent) 50%, color-mix(in oklch, var(--color-ink) 45%, transparent) 72%, color-mix(in oklch, var(--color-ink) 15%, transparent) 100%), linear-gradient(to right, color-mix(in oklch, var(--color-ink) 85%, transparent) 0%, transparent 60%), linear-gradient(to bottom, color-mix(in oklch, var(--color-ink) 70%, transparent) 0%, transparent 16%)"
          : "linear-gradient(to top, var(--color-ink) 0%, var(--color-ink) 40%, color-mix(in oklch, var(--color-ink) 88%, transparent) 50%, color-mix(in oklch, var(--color-ink) 45%, transparent) 60%, transparent 68%), linear-gradient(to right, color-mix(in oklch, var(--color-ink) 82%, transparent) 0%, transparent 58%), linear-gradient(to bottom, color-mix(in oklch, var(--color-ink) 70%, transparent) 0%, transparent 16%)",
      }}
    />
  );
}

/** The left margin: catalogue number, the seen annotation and the section band, read top to bottom. */
export function Margin({
  number,
  seen,
  section,
}: {
  readonly number: number | null;
  readonly seen: boolean;
  readonly section: string;
}) {
  return (
    <div className="flex w-margin shrink-0 flex-col items-start gap-4 self-stretch">
      {number === null ? null : (
        <p className="m-0 flex items-baseline gap-1 leading-none">
          <span className="text-body font-[560] text-paper-dim stretch-condensed">No.</span>
          <span className="text-title font-[300] stretch-condensed">
            {String(number).padStart(3, "0")}
          </span>
        </p>
      )}
      {seen ? (
        <span className="flex items-center gap-2 text-caption font-[620] text-paper stretch-condensed">
          <SeenMark />
          Seen
        </span>
      ) : null}
      <div className="flex min-h-[12rem] w-[3.5rem] flex-1 items-end justify-center bg-band pb-4">
        <span className="text-body font-[760] whitespace-nowrap text-paper stretch-wide [writing-mode:vertical-rl] rotate-180">
          {section}
        </span>
      </div>
    </div>
  );
}

/** The title as the programme sets it: the film's own logo, or its name wide and heavy. */
export function TitleMark({
  entry,
  server,
  compact,
}: {
  readonly entry: Entry;
  readonly server: ServerUrl;
  readonly compact: boolean;
}) {
  const name = entry.kind === "Episode" && entry.series !== null ? entry.series.name : entry.title;
  if (entry.logo !== null) {
    return (
      <h1 className="m-0">
        <img
          alt={name}
          src={imageUrl(
            server,
            entry.logo,
            0.33 * window.innerWidth * (window.devicePixelRatio || 1),
          )}
          className={`block w-auto max-w-[33vw] object-contain object-left-bottom drop-shadow-[0_0.25rem_1.5rem_var(--color-shade)] ${
            compact ? "max-h-[8rem]" : "max-h-[13rem]"
          }`}
        />
      </h1>
    );
  }
  return (
    <h1
      className={`m-0 max-w-[38vw] font-[820] text-balance stretch-extra-wide ${
        compact ? "text-title" : "text-marquee"
      }`}
    >
      {name}
    </h1>
  );
}

export function EntryNotes({
  entry,
  children,
}: {
  readonly entry: Entry;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {entry.kind === "Episode" ? (
        <p className="text-body font-[620] text-paper stretch-semicondensed">{entry.title}</p>
      ) : null}
      <ProgrammeNotes facts={programmeNotes(entry)} />
      {children}
    </div>
  );
}
