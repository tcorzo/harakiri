/** What shows while a screen's first data is on its way: the house at rest, with the name. */
export const Curtain = () => (
  <main aria-busy="true" className="bg-ink px-safe-x py-safe-y flex h-screen items-end">
    <span className="text-heading text-paper-faint stretch-extra-wide font-[820]">harakiri</span>
  </main>
);
