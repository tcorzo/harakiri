import type { JsonValue } from "./protocol";
import { commandName } from "./redact";

export class MpvCommandError extends Error {
  /** The command's name only, e.g. `loadfile`; never its arguments. */
  readonly command: string;
  readonly mpvError: string;
  constructor(command: readonly JsonValue[], mpvError: string) {
    const name = commandName(command);
    super(`mpv command ${JSON.stringify(name)} failed: ${mpvError}`);
    this.name = "MpvCommandError";
    this.command = name;
    this.mpvError = mpvError;
  }
}
