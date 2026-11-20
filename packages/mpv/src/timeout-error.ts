import type { JsonValue } from "./protocol";
import { commandName } from "./redact";

export class MpvTimeoutError extends Error {
  /** The command's name only, e.g. `sub-add`; never its arguments. */
  readonly command: string;
  readonly timeoutMs: number;
  constructor(command: readonly JsonValue[], timeoutMs: number) {
    const name = commandName(command);
    super(`mpv did not answer ${JSON.stringify(name)} within ${timeoutMs}ms`);
    this.name = "MpvTimeoutError";
    this.command = name;
    this.timeoutMs = timeoutMs;
  }
}
