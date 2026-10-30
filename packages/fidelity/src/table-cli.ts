import { writeFileSync } from "node:fs";
import { renderTables } from "./table";

const [path] = process.argv.slice(2);
if (path === undefined) throw new Error("usage: table-cli.ts <output.md>");
writeFileSync(path, renderTables());
