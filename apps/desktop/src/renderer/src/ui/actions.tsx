import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import type { FocusableComponentLayout } from "@noriginmedia/norigin-spatial-navigation";
import type { ReactNode } from "react";

interface ActionProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly focusKey?: string;
  readonly onFocus?: (layout: FocusableComponentLayout) => void;
  readonly children?: ReactNode;
  /** False while the action is hidden, so the d-pad never lands on something the owner cannot see. */
  readonly focusable?: boolean;
}

function useAction({ focusKey, onFocus, focusable }: ActionProps) {
  return useFocusable<object, HTMLButtonElement>({
    ...(focusKey === undefined ? {} : { focusKey }),
    ...(onFocus === undefined ? {} : { onFocus }),
    focusable: focusable !== false,
  });
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 20 22" aria-hidden="true" className="h-[0.8em] w-auto fill-current">
      <path d="M1.5 1.4v19.2c0 .8.9 1.3 1.6.9l16-9.6c.6-.4.6-1.4 0-1.8l-16-9.6c-.7-.4-1.6.1-1.6.9Z" />
    </svg>
  );
}

/** The only red action: Play and Resume, paper on Harakiri Red. Bands share the red but never take focus. */
export function PlayAction(props: ActionProps) {
  const { ref } = useAction(props);

  return (
    <button
      ref={ref}
      type="button"
      aria-label={props.label}
      tabIndex={props.focusable === false ? -1 : undefined}
      onClick={props.onPress}
      className="focus-mark bg-play text-heading text-play-ink stretch-wide flex h-[4.5rem] shrink-0 items-center gap-4 px-8 font-[780]"
    >
      <PlayGlyph />
      <span>{props.children ?? props.label}</span>
    </button>
  );
}

/** Every other action: paper type in a hairline frame, so Play stays the only red thing the d-pad lands on. */
export function QuietAction(props: ActionProps) {
  const { ref } = useAction(props);

  return (
    <button
      ref={ref}
      type="button"
      aria-label={props.label}
      tabIndex={props.focusable === false ? -1 : undefined}
      onClick={props.onPress}
      className="focus-mark hairline text-body text-paper stretch-semicondensed focus-visible:border-paper focus-visible:bg-paper focus-visible:text-ink flex h-[4.5rem] shrink-0 items-center gap-3 border-2 px-7 font-[560]"
    >
      {props.children ?? props.label}
    </button>
  );
}

/** A full-width line in a list: a choice in a programme index rather than a button. */
export function ListAction(props: ActionProps & { readonly detail?: ReactNode }) {
  const { ref } = useAction(props);

  return (
    <button
      ref={ref}
      type="button"
      aria-label={props.label}
      onClick={props.onPress}
      className="group focus-mark hairline focus-visible:bg-paper focus-visible:text-ink flex min-h-[4.5rem] w-full items-baseline gap-8 border-b-2 px-4 py-4 text-left focus-visible:transform-none"
    >
      <span className="text-heading stretch-wide font-[700]">{props.children ?? props.label}</span>
      {props.detail === undefined ? null : (
        <span className="text-notes text-paper-dim stretch-condensed group-focus-visible:text-ink">
          {props.detail}
        </span>
      )}
    </button>
  );
}
