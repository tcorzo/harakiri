import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runningHelper, widgetSrc } from "./impeccable-live";

describe("impeccable live dev plugin", () => {
  let dir = "";
  let serverFile = "";

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "harakiri-live-"));
    serverFile = path.join(dir, "server.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds the helper while its process runs", () => {
    writeFileSync(serverFile, JSON.stringify({ pid: process.pid, port: 8400, token: "t-1" }));

    expect(runningHelper(serverFile)).toStrictEqual({ pid: process.pid, port: 8400, token: "t-1" });
  });

  it("finds nothing without the file, with a malformed one, or once the process has exited", () => {
    expect(runningHelper(serverFile)).toBeNull();

    writeFileSync(serverFile, "{ not json");
    expect(runningHelper(serverFile)).toBeNull();

    writeFileSync(serverFile, JSON.stringify({ pid: process.pid, port: 8400 }));
    expect(runningHelper(serverFile)).toBeNull();

    // The largest pid Linux allows is 2^22; one above it is never a running process.
    writeFileSync(serverFile, JSON.stringify({ pid: 4_194_305, port: 8400, token: "t-1" }));
    expect(runningHelper(serverFile)).toBeNull();
  });

  it("loads the widget same-origin, with the session token the helper requires", () => {
    expect(widgetSrc({ pid: 1, port: 8401, token: "a b&c" })).toBe(
      "/__impeccable/live.js?token=a+b%26c"
    );
  });
});
