import { expect, test } from "vitest";

import { MpvCommandError } from "./client";
import type { JsonValue } from "./client";
import { setHttpHeaders } from "./http";

test("a header mpv rejects fails without quoting the secret", async () => {
  const sent: JsonValue[] = [];

  const client = {
    setProperty: async (name: string, value: JsonValue) => {
      sent.push(value);

      return await Promise.reject(
        new MpvCommandError(["set_property", name, value], "error running")
      );
    },
  };

  const error: unknown = await setHttpHeaders(client, {
    Authorization: 'MediaBrowser Token="s3cret"',
  }).catch((caught: unknown) => caught);

  expect(sent).toEqual([['Authorization: MediaBrowser Token="s3cret"']]);
  expect(error).toBeInstanceOf(MpvCommandError);
  expect(error).toMatchObject({ command: "set_property", mpvError: "error running" });
  expect(String(error)).not.toContain("s3cret");
});
