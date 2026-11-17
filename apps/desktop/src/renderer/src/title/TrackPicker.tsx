import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useEffect } from "react";
import { useActionHandler } from "../input/handlers";
import { ListAction } from "../ui/actions";
import { focusFirst } from "../ui/focus";

export interface TrackOption {
  readonly index: number;
  readonly label: string;
  readonly detail?: string;
}

/** A side sheet listing tracks; Back closes it without changing the choice. */
export function TrackPicker({
  title,
  options,
  chosen,
  onChoose,
  onClose,
}: {
  readonly title: string;
  readonly options: readonly TrackOption[];
  readonly chosen: number;
  readonly onChoose: (index: number) => void;
  readonly onClose: () => void;
}) {
  const { ref, focusKey } = useFocusable<object, HTMLElement>({
    focusKey: "track-picker",
    isFocusBoundary: true,
  });
  useActionHandler("back", onClose);
  const chosenPosition = Math.max(
    0,
    options.findIndex((option) => option.index === chosen),
  );

  useEffect(() => {
    focusFirst(`track-${chosenPosition}`, "track-0");
  }, [chosenPosition]);

  return (
    <FocusContext.Provider value={focusKey}>
      <section
        ref={ref}
        aria-label={title}
        className="absolute inset-y-0 right-0 z-20 flex w-[46rem] flex-col gap-6 bg-ink-raised pl-12 pr-safe-x py-safe-y shadow-[-1.5rem_0_4rem_var(--color-shade)]"
      >
        <h2 className="m-0 bg-band px-4 py-1.5 self-start text-body font-[760] stretch-wide">
          {title}
        </h2>
        <div className="-mx-3 flex flex-col overflow-hidden px-3 py-2">
          {options.map((option, i) => (
            <ListAction
              key={option.index}
              focusKey={`track-${i}`}
              label={`${option.label}${option.index === chosen ? ", chosen" : ""}`}
              detail={option.index === chosen ? "Chosen" : option.detail}
              onFocus={({ node }) => node.scrollIntoView({ block: "nearest" })}
              onPress={() => onChoose(option.index)}
            >
              {option.label}
            </ListAction>
          ))}
        </div>
      </section>
    </FocusContext.Provider>
  );
}
