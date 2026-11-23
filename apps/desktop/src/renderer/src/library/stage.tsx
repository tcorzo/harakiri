import type { ServerUrl } from "@harakiri/jellyfin";
import { useState } from "react";
import type { ReactNode } from "react";

import { imageUrl, programmeNotes } from "../data/entry";
import type { Entry, ImageRef } from "../data/entry";
import { ProgrammeNotes } from "../ui/marks";

export const backdropUrl = (server: ServerUrl, image: ImageRef): string =>
  imageUrl(server, image, Math.min(3840, window.screen.width * (window.devicePixelRatio || 1)));

/** Cross-fades from the previous backdrop to the new one so a re-light never flashes to black. */
export const Backdrop = ({ url }: { readonly url: string | null }) => {
  const [layers, setLayers] = useState<readonly (string | null)[]>([url]);

  if (layers.at(-1) !== url) {
    setLayers([layers.at(-1) ?? null, url]);
  }

  return (
    <div aria-hidden="true" className="bg-ink absolute inset-0 overflow-hidden">
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
        )
      )}
    </div>
  );
};

/** The programme-ink field under the type: deep over rows and title pages, light and low on the hero. */
export const InkField = ({ deep }: { readonly deep: boolean }) => (
  <div
    aria-hidden="true"
    className="ease-curtain absolute inset-0 transition-opacity duration-700"
    style={{
      // An eased ramp rather than a hard stop, so a bright backdrop fades into the ink instead of
      // ending on a horizon line; the thin top band keeps the wordmark and Settings legible. The
      // hero's light field ends low, so the artwork carries the first view.
      background: deep
        ? "linear-gradient(to top, var(--color-ink) 0%, var(--color-ink) 35%, color-mix(in oklch, var(--color-ink) 85%, transparent) 50%, color-mix(in oklch, var(--color-ink) 45%, transparent) 72%, color-mix(in oklch, var(--color-ink) 15%, transparent) 100%), linear-gradient(to right, color-mix(in oklch, var(--color-ink) 85%, transparent) 0%, transparent 60%), linear-gradient(to bottom, color-mix(in oklch, var(--color-ink) 70%, transparent) 0%, transparent 16%)"
        : "linear-gradient(to top, var(--color-ink) 0%, var(--color-ink) 14%, color-mix(in oklch, var(--color-ink) 78%, transparent) 26%, color-mix(in oklch, var(--color-ink) 38%, transparent) 38%, transparent 50%), linear-gradient(to right, color-mix(in oklch, var(--color-ink) 60%, transparent) 0%, transparent 48%), linear-gradient(to bottom, color-mix(in oklch, var(--color-ink) 60%, transparent) 0%, transparent 14%)",
    }}
  />
);

/** The title as the programme sets it: the film's own logo, or its name wide and heavy. */
export const TitleMark = ({
  entry,
  server,
  compact,
}: {
  readonly entry: Entry;
  readonly server: ServerUrl;
  readonly compact: boolean;
}) => {
  const name = entry.kind === "Episode" && entry.series !== null ? entry.series.name : entry.title;

  if (entry.logo !== null) {
    return (
      <h1 className="m-0">
        <img
          alt={name}
          src={imageUrl(
            server,
            entry.logo,
            0.33 * window.innerWidth * (window.devicePixelRatio || 1)
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
      className={`stretch-extra-wide m-0 max-w-[38vw] font-[820] text-balance ${
        compact ? "text-title" : "text-marquee"
      }`}
    >
      {name}
    </h1>
  );
};

export const EntryNotes = ({
  entry,
  children,
}: {
  readonly entry: Entry;
  readonly children?: ReactNode;
}) => (
  <div className="flex flex-col gap-3">
    {entry.kind === "Episode" ? (
      <p className="text-body text-paper stretch-semicondensed font-[620]">{entry.title}</p>
    ) : null}
    <ProgrammeNotes facts={programmeNotes(entry)} seen={entry.played} />
    {children}
  </div>
);
