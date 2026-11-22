import type { Direction } from "@harakiri/input";
import { getCurrentFocusKey } from "@noriginmedia/norigin-spatial-navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { match } from "ts-pattern";

import { useActionHandler, useNavigationGuard } from "../input/handlers";
import { QuietAction } from "../ui/actions";
import { focusFirst } from "../ui/focus";
import { Notice, SectionHead } from "../ui/marks";
import { dismiss, isDismissed } from "./dismissal";
import {
  addOutcomeLine,
  addResultOf,
  isProblem,
  launcherStatusQuery,
  useAddingToLauncher,
  useAddToLauncher,
} from "./queries";

/** The card's first action. The library focuses it before Play, so the card owns focus while it shows. */
export const launcherAddKey = "launcher-add";
const notNowKey = "launcher-not-now";

/** Left and right pick an action; up and down stay on the card, which holds the d-pad until answered. */
const targetFor = (direction: Direction, current: string | null): string =>
  match(direction)
    .with("left", () => launcherAddKey)
    .with("right", () => notNowKey)
    .with("up", "down", () => (current === notNowKey ? notNowKey : launcherAddKey))
    .exhaustive();

const Offer = ({
  name,
  adding,
  problem,
  onAdd,
  onNotNow,
}: {
  readonly name: string;
  readonly adding: boolean;
  readonly problem: string | null;
  readonly onAdd: () => void;
  readonly onNotNow: () => void;
}) => {
  // Overlay claims: the card can draw in the library's first render, before the library claims.
  useActionHandler("back", onNotNow, "overlay");
  useNavigationGuard((direction) => {
    // Typed as a string, but null while nothing has focus.
    const current: string | null = getCurrentFocusKey();
    focusFirst(targetFor(direction, current));

    return true;
  }, "overlay");

  useEffect(() => {
    focusFirst(launcherAddKey);
  }, []);

  const label = adding ? `Adding to ${name}…` : `Add to ${name}`;

  return (
    <section
      aria-label={`Play harakiri from ${name}`}
      // Under the Settings link and clear of the hero, so Play stays in view; Raised Ink, as the
      // track sheet, so its type never sits on the raw backdrop.
      className="bg-ink-raised pr-safe-x absolute top-[calc(var(--spacing-safe-y)+4.5rem)] right-0 z-10 flex w-[46rem] flex-col gap-6 py-9 pl-12"
    >
      <SectionHead>{`Play harakiri from ${name}`}</SectionHead>
      {/* One sentence a line, as the sketch sets it; the space keeps the text one sentence pair. */}
      <p className="text-body text-paper-dim m-0">
        <span className="block">{`Adds harakiri to your ${name} library, with its art.`}</span>{" "}
        <span className="block">Launch it from there in Game Mode.</span>
      </p>
      <div className="flex items-center gap-6 pt-2">
        <QuietAction focusKey={launcherAddKey} label={label} onPress={onAdd} />
        <QuietAction focusKey={notNowKey} label="Not now" onPress={onNotNow} />
      </div>
      {problem === null ? null : <Notice>{problem}</Notice>}
    </section>
  );
};

/** Leaving the card returns to tonight's screening, or to Settings when there is none. */
const leave = (): void => {
  focusFirst("hero-play", "library-settings");
};

/** Offers to add harakiri to the game launcher, once, until the owner adds it or says Not now. */
export const LauncherCard = () => {
  const { data: status } = useQuery(launcherStatusQuery);
  const add = useAddToLauncher();
  const adding = useAddingToLauncher();
  // Read once: a Not now chosen elsewhere this session does not pull the card from under focus.
  const [dismissed, setDismissed] = useState(isDismissed);

  if (status?.state !== "offered" || dismissed) {
    return null;
  }

  const result = addResultOf(add);

  return (
    <Offer
      name={status.name}
      adding={adding}
      problem={isProblem(result, adding) ? addOutcomeLine(status.name, result, false) : null}
      onAdd={() => {
        if (adding) {
          return;
        }

        add.mutate(undefined, {
          // Runs once the status has been read again, when the card has already gone.
          onSuccess: (added) => {
            if (added.state === "added") {
              leave();
            }
          },
        });
      }}
      onNotNow={() => {
        dismiss();
        setDismissed(true);
        leave();
      }}
    />
  );
};
