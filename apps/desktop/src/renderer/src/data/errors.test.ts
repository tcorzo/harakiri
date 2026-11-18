import { expect, test } from "vitest";
import { z } from "zod";

import { fromIpc } from "../../../shared/errors";
import { classifyFailure, ServerStatusError } from "./errors";

const url = "http://jf.test/Users/u/Items?api_key=secret";

test("only a 401 reads as signed out; a 403 is a refusal with a good token", () => {
  expect(classifyFailure(new ServerStatusError(401, url))).toEqual({ kind: "signedOut" });
  expect(classifyFailure(new ServerStatusError(403, url))).toEqual({ kind: "refused" });
  expect(classifyFailure(new ServerStatusError(500, url))).toEqual({ kind: "server", status: 500 });
});

test("only a failed connection reads as unreachable; anything else says what it was", () => {
  const network = Object.assign(new Error("Request failed due to a network error: GET /x"), {
    name: "NetworkError",
  });
  const timeout = new DOMException("signal timed out", "TimeoutError");
  expect(classifyFailure(network)).toEqual({ kind: "unreachable" });
  expect(classifyFailure(timeout)).toEqual({ kind: "unreachable" });
  expect(classifyFailure(new TypeError("Failed to fetch"))).toEqual({ kind: "unreachable" });

  const zodError = z.string().safeParse(1).error;
  expect(classifyFailure(zodError)).toMatchObject({ kind: "unexpected" });
  expect(classifyFailure(new TypeError("Cannot read properties of undefined"))).toEqual({
    kind: "unexpected",
    message: "Cannot read properties of undefined",
  });
});

test("the message names the path only, never the query and the key it can carry", () => {
  expect(new ServerStatusError(401, url).message).toBe(
    "The server answered 401 for /Users/u/Items"
  );
});

test("a status error from main survives Electron's IPC wrapping, status and all", () => {
  const crossed = fromIpc(
    new Error(
      "Error invoking remote method 'player:prepare': ServerStatusError: The server answered 401 for /Items/x/PlaybackInfo"
    )
  );
  expect(crossed).toBeInstanceOf(ServerStatusError);
  expect(crossed).toMatchObject({
    status: 401,
    message: "The server answered 401 for /Items/x/PlaybackInfo",
  });
  expect(classifyFailure(crossed)).toEqual({ kind: "signedOut" });

  const other = fromIpc(
    new Error("Error invoking remote method 'player:play': Error: mpv could not play the file")
  );
  expect(other).not.toBeInstanceOf(ServerStatusError);
  expect(other).toMatchObject({ message: "mpv could not play the file" });
});
