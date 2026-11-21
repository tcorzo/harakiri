import type { MpvExit } from "./client";

/** mpv exited before its IPC socket was ready. */
export class MpvStartError extends Error {
  override readonly name = "MpvStartError";

  readonly exit: MpvExit;
  readonly fatal: readonly string[];

  constructor(exit: MpvExit, fatal: readonly string[]) {
    super(
      fatal.length > 0
        ? fatal.join(" ")
        : `mpv exited before its IPC socket was ready (code ${exit.code ?? exit.signal})`
    );
    this.exit = exit;
    this.fatal = fatal;
  }
}

const FATAL = /Error|Fatal|failed/iu;
const MODULE_TAG = /^\[[^\]]*\]\s*/u;

/** The last 3 lines matching /Error|Fatal|failed/iu (case-insensitive), without a leading "[module] " tag. Input is already redacted. */
export const fatalLines = (tail: readonly string[]): string[] =>
  tail
    .filter((line) => FATAL.test(line))
    .slice(-3)
    .map((line) => line.replace(MODULE_TAG, ""));
