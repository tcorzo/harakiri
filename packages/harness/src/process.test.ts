import { describe, expect, it } from "vitest";

import { runTool, runToolOrThrow } from "./process";

describe(runTool, () => {
  it("SIGKILLs a tool that outlives its deadline and says so", () => {
    expect(runTool("sleep", ["5"], 200)).toStrictEqual({
      kind: "killed",
      signal: "SIGKILL",
      timedOutAfterMs: 200,
      stdout: "",
      stderr: "",
    });
    expect(() => runToolOrThrow("sleep", ["5"], 200)).toThrow(
      "sleep 5 timed out after 200ms and was killed by SIGKILL:\n"
    );
  });

  it("tells a tool killed by someone else apart from a timeout", () => {
    expect(runTool("sh", ["-c", "kill -TERM $$"])).toMatchObject({
      kind: "killed",
      signal: "SIGTERM",
      timedOutAfterMs: null,
    });
  });

  it("reports a normal exit with its code", () => {
    expect(runTool("sh", ["-c", "echo out; exit 3"])).toStrictEqual({
      kind: "exited",
      code: 3,
      stdout: "out\n",
      stderr: "",
    });
  });
});
