import { describe, expect, test } from "vitest";
import { runTool, runToolOrThrow } from "./process";

describe("runTool", () => {
  test("SIGKILLs a tool that outlives its deadline and says so", () => {
    expect(runTool("sleep", ["5"], 200)).toEqual({
      kind: "killed",
      signal: "SIGKILL",
      timedOutAfterMs: 200,
      stdout: "",
      stderr: "",
    });
    expect(() => runToolOrThrow("sleep", ["5"], 200)).toThrow(
      "sleep 5 timed out after 200ms and was killed by SIGKILL:\n",
    );
  });

  test("tells a tool killed by someone else apart from a timeout", () => {
    expect(runTool("sh", ["-c", "kill -TERM $$"])).toMatchObject({
      kind: "killed",
      signal: "SIGTERM",
      timedOutAfterMs: null,
    });
  });

  test("reports a normal exit with its code", () => {
    expect(runTool("sh", ["-c", "echo out; exit 3"])).toEqual({
      kind: "exited",
      code: 3,
      stdout: "out\n",
      stderr: "",
    });
  });
});
