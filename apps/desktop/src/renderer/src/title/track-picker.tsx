import { useEffect } from "react";

import { ListAction } from "../ui/actions";
import { focusFirst } from "../ui/focus";
import { Sheet } from "../ui/sheet";

export interface TrackOption {
  readonly index: number;
  readonly label: string;
  readonly detail?: string;
}

/** A side sheet listing tracks; Back closes it without changing the choice. */
export const TrackPicker = ({
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
}) => {
  const chosenPosition = Math.max(
    0,
    options.findIndex((option) => option.index === chosen)
  );

  useEffect(() => {
    focusFirst(`track-${chosenPosition}`, "track-0");
  }, [chosenPosition]);

  return (
    <Sheet title={title} focusKey="track-picker" onClose={onClose}>
      {options.map((option, i) => (
        <ListAction
          key={option.index}
          focusKey={`track-${i}`}
          label={`${option.label}${option.index === chosen ? ", chosen" : ""}`}
          detail={option.index === chosen ? "Chosen" : option.detail}
          onFocus={({ node }) => {
            node.scrollIntoView({ block: "nearest" });
          }}
          onPress={() => {
            onChoose(option.index);
          }}
        >
          {option.label}
        </ListAction>
      ))}
    </Sheet>
  );
};
