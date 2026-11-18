#!/usr/bin/env bun
import { intro, log, outro } from "@clack/prompts";
import { configure, getConsoleSink, getLogger } from "@logtape/logtape";
import { prettyFormatter } from "@logtape/pretty";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { command, constant } from "@optique/core/primitives";
import { run } from "@optique/run";
import { match } from "ts-pattern";

import { CHECKS, requiredFailures, runChecks } from "./doctor";
import type { CheckResult } from "./doctor";

const parser = command("doctor", object({ command: constant("doctor") }), {
  description: message`Check that the tools the validation harness drives are installed and new enough.`,
});

function report({ check, verdict }: CheckResult): void {
  const line = `${check.label}: ${verdict.detail}`;
  match(verdict.status)
    .with("ok", () => {
      log.success(line);
    })
    .with("missing", "outdated", () => {
      check.required ? log.error(line) : log.warn(`${line} (optional)`);
    })
    .exhaustive();
}

async function doctor(): Promise<number> {
  intro("harakiri-harness doctor");
  const results = runChecks(CHECKS);

  for (const result of results) {
    getLogger(["harakiri", "harness", "doctor"]).debug("{label} probed with {probe}", {
      label: result.check.label,
      probe: result.check.probe.join(" "),
    });
    report(result);
  }

  const failed = requiredFailures(results);
  outro(
    failed.length === 0
      ? "All required tools present."
      : `${failed.length} required check(s) failed.`
  );

  return failed.length === 0 ? 0 : 1;
}

await configure({
  sinks: { console: getConsoleSink({ formatter: prettyFormatter }) },
  loggers: [
    { category: ["harakiri"], lowestLevel: "info", sinks: ["console"] },
    { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
  ],
});

const parsed = run(parser, { programName: "harakiri-harness", help: "both" });

process.exitCode = await match(parsed.command)
  .with("doctor", async () => await doctor())
  .exhaustive();
