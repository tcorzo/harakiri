import { getCurrentFocusKey } from "@noriginmedia/norigin-spatial-navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { useActionHandler } from "../input/handlers";
import { quitLine, updateStatusQuery } from "../settings/quit-line";
import { focusFirst } from "../ui/focus";
import { Sheet, SheetAction } from "../ui/sheet";

/** Asks before the library's last Back leaves the app; Stay is focused, so a stray press stays. */
const ExitSheet = ({ onStay }: { readonly onStay: () => void }) => {
  const { data: updates } = useQuery(updateStatusQuery);

  useEffect(() => {
    focusFirst("exit-stay");
  }, []);

  return (
    <Sheet title="Leave harakiri?" focusKey="exit-sheet" onClose={onStay}>
      <SheetAction focusKey="exit-stay" label="Stay" then={onStay} />
      <SheetAction
        focusKey="exit-quit"
        label="Quit harakiri"
        detail={quitLine(updates)}
        closes={false}
        then={() => {
          void window.harakiri.app.quit();
        }}
      />
    </Sheet>
  );
};

/** The exit sheet, and while it is open, where focus was when Back opened it. */
type Exit = { readonly kind: "closed" } | { readonly kind: "open"; readonly from: string | null };

/**
 * Back from the rows returns to tonight's screening first; from there, or with no screening to
 * return to, it asks to leave. Returns the exit sheet while it is open.
 */
export const useBackToLeave = (holding: boolean, hero: boolean): ReactNode => {
  const [exit, setExit] = useState<Exit>({ kind: "closed" });

  useActionHandler("back", () => {
    if (!holding && hero) {
      focusFirst("hero-play");

      return;
    }

    setExit({ kind: "open", from: getCurrentFocusKey() });
  });

  if (exit.kind === "closed") {
    return null;
  }

  return (
    <ExitSheet
      onStay={() => {
        setExit({ kind: "closed" });
        focusFirst(...(exit.from === null ? [] : [exit.from]), "hero-play", "library-settings");
      }}
    />
  );
};
