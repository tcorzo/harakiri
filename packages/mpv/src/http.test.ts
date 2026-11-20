import { describe, expect, it } from "vitest";

import { MpvCommandError } from "./client";
import type { JsonValue } from "./client";
import { setHttpHeaders } from "./http";

describe(setHttpHeaders, () => {
  it("a header mpv rejects fails without quoting the secret", async () => {
    const sent: JsonValue[] = [];

    const client = {
      setProperty: async (name: string, value: JsonValue) => {
        sent.push(value);

        return await Promise.reject(
          new MpvCommandError(["set_property", name, value], "error running")
        );
      },
    };

    let error: unknown;

    try {
      await setHttpHeaders(client, { Authorization: 'MediaBrowser Token="s3cret"' });
    } catch (error_) {
      error = error_;
    }

    expect(sent).toStrictEqual([['Authorization: MediaBrowser Token="s3cret"']]);
    expect(error).toBeInstanceOf(MpvCommandError);
    expect(error).toMatchObject({ command: "set_property", mpvError: "error running" });
    expect(String(error)).not.toContain("s3cret");
  });
});
