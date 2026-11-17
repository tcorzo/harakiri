/** What shows while a screen's first data is on its way: the house at rest, with the name. */
export function Curtain() {
  return (
    <main aria-busy="true" className="flex h-screen items-end bg-ink px-safe-x py-safe-y">
      <span className="text-heading font-[820] text-paper-faint stretch-extra-wide">harakiri</span>
    </main>
  );
}
