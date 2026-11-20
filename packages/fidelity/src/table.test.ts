import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { renderTables } from "./table";

const committed = path.join(import.meta.dirname, "../../../docs/fidelity/compatibility.md");

describe("the committed compatibility table", () => {
  it("is what the engine decides today", () => {
    expect(readFileSync(committed, "utf-8")).toBe(renderTables());
  });
});
