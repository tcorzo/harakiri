import type { MpvClient } from "./client";

export type HttpHeaders = Readonly<Record<string, string>>;

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

/**
 * Replaces the headers mpv sends with every HTTP request, over IPC so a secret such as the
 * Jellyfin token never reaches argv. Call it before `loadfile`. The value is a list, so the
 * commas inside `Authorization: MediaBrowser Token="…", Client="…"` stay intact.
 */
export const setHttpHeaders = async (
  client: Pick<MpvClient, "setProperty">,
  headers: HttpHeaders
): Promise<void> => {
  const fields = Object.entries(headers).map(([name, value]) => {
    // The value is never echoed: it is usually the secret.
    if (!TOKEN.test(name) || /[\r\n]/u.test(value)) {
      throw new TypeError(`invalid HTTP header ${JSON.stringify(name)}`);
    }

    return `${name}: ${value}`;
  });

  // A failure cannot quote the value: mpv's errors carry the command name only.
  await client.setProperty("http-header-fields", fields);
};
