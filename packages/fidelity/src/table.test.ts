import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { renderTables } from "./table";

const committed = join(import.meta.dirname, "../../../docs/fidelity/compatibility.md");

test("the committed compatibility table is what the engine decides today", () => {
  expect(readFileSync(committed, "utf8")).toBe(renderTables());
});
