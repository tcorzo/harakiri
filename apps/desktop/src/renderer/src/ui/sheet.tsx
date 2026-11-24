import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import type { ReactNode } from "react";

import { useActionHandler } from "../input/handlers";
import { SectionHead } from "./marks";

/**
 * A raised panel from the right that holds focus until the owner answers it; Back closes it. Its
 * owner focuses a row once it mounts.
 */
export const Sheet = ({
  title,
  focusKey,
  onClose,
  children,
}: {
  readonly title: string;
  readonly focusKey: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) => {
  const { ref, focusKey: boundary } = useFocusable<object, HTMLElement>({
    focusKey,
    isFocusBoundary: true,
  });

  useActionHandler("back", onClose, "overlay");

  return (
    <FocusContext.Provider value={boundary}>
      <section
        ref={ref}
        aria-label={title}
        className="bg-ink-raised pr-safe-x py-safe-y absolute inset-y-0 right-0 z-20 flex w-[46rem] flex-col gap-6 pl-12 shadow-[-1.5rem_0_4rem_var(--color-shade)]"
      >
        <SectionHead>{title}</SectionHead>
        <div className="-mx-3 flex flex-col overflow-hidden px-3 py-2">{children}</div>
      </section>
    </FocusContext.Provider>
  );
};
