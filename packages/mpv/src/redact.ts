import { z } from "zod";

import type { JsonValue } from "./protocol";

const secretParam = /\b(?<key>ApiKey|api_key|X-Emby-Token)=[^&\s'"]+/giu;

// Verbose mpv echoes `Set property: http-header-fields=["Authorization: MediaBrowser Token=\"…\""]`.
const tokenField = /\b(?<label>Token=)(?<quote>\\?")?[^"\s,\\]+/gu;

/**
 * mpv echoes URLs it opens, where Jellyfin sidecar and stream URLs carry the token as a query
 * param, and verbose mpv echoes the Authorization header it was given.
 */
export const redactSecrets = (line: string): string =>
  line
    .replaceAll(secretParam, "$<key>=REDACTED")
    .replaceAll(tokenField, "$<label>$<quote>REDACTED");

/**
 * The name of an mpv command, and nothing else. Its arguments carry stream and sidecar URLs with
 * `api_key`/`ApiKey` and the Authorization header value, so an error or a log line that quoted
 * them would print the token; keeping only the verb makes that impossible for every caller.
 */
export const commandName = (command: readonly JsonValue[]): string => {
  const verb = z.string().safeParse(command[0]);

  return verb.success ? redactSecrets(verb.data) : "(unnamed)";
};
