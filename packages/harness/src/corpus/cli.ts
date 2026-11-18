#!/usr/bin/env bun
// The synthetic media corpus: generate it, fetch the FATE tier, check a Jellyfin scan of it.
// Run through mise so the pinned dovi_tool is on PATH: mise run media:gen | media:fetch-fate | test:corpus
import { resolve } from "node:path";

import { intro, log, outro } from "@clack/prompts";
import { object, or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional, withDefault } from "@optique/core/modifiers";
import { command, constant, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { run } from "@optique/run";
import { match } from "ts-pattern";

import { classifyCorpus } from "./classify";
import { DEFAULT_FATE_MIRROR, fetchFate } from "./fate";
import { generateCorpus, treeBytes } from "./generate";

const REPO = resolve(import.meta.dirname, "../../../..");
const DEFAULT_OUT = process.env.HARAKIRI_CORPUS_DIR ?? resolve(REPO, ".cache/corpus");
const DEFAULT_FATE = process.env.HARAKIRI_FATE_DIR ?? resolve(REPO, ".cache/fate");

const parser = or(
  command(
    "gen",
    object({
      command: constant("gen"),
      out: withDefault(option("--out", string({ metavar: "DIR" })), DEFAULT_OUT),
      fate: withDefault(option("--fate", string({ metavar: "DIR" })), DEFAULT_FATE),
      requireFate: option("--require-fate"),
    }),
    { description: message`Write the synthetic Jellyfin library (default .cache/corpus).` }
  ),
  command(
    "fetch-fate",
    object({
      command: constant("fetch-fate"),
      dir: withDefault(option("--dir", string({ metavar: "DIR" })), DEFAULT_FATE),
      mirror: withDefault(
        option("--mirror", string({ metavar: "URL" })),
        process.env.HARAKIRI_FATE_MIRROR ?? DEFAULT_FATE_MIRROR
      ),
    }),
    { description: message`Fetch the pinned FFmpeg FATE samples (default .cache/fate).` }
  ),
  command(
    "classify",
    object({
      command: constant("classify"),
      corpus: withDefault(option("--corpus", string({ metavar: "DIR" })), DEFAULT_OUT),
      server: optional(option("--server", string({ metavar: "URL" }))),
      waitSeconds: withDefault(option("--wait", integer({ min: 0 })), 0),
    }),
    {
      description: message`Check a Jellyfin scan of the corpus against the catalog's classification.`,
    }
  )
);

async function gen(out: string, fate: string, requireFate: boolean): Promise<number> {
  intro(`corpus gen -> ${out}`);
  const t0 = performance.now();

  const manifest = await generateCorpus({
    out: resolve(out),
    fateDir: resolve(fate),
    requireFate,
    log: (line) => {
      line.startsWith("FATE TIER NOT BUILT") ? log.warn(line) : log.step(line);
    },
  });

  const seconds = ((performance.now() - t0) / 1000).toFixed(1);
  const mb = (treeBytes(resolve(out)) / 1e6).toFixed(1);
  outro(
    `${manifest.entries.length} media files, ${mb} MB, ${seconds}s${
      manifest.skipped.length > 0 ? `; ${manifest.skipped.length} FATE items left out` : ""
    }`
  );

  return 0;
}

async function fetchFateCommand(dir: string, mirror: string): Promise<number> {
  intro(`fetch FATE samples from ${mirror} -> ${dir}`);
  await fetchFate(resolve(dir), mirror, (line) => {
    log.step(line);
  });
  outro("all FATE samples verified");

  return 0;
}

const parsed = run(parser, { programName: "corpus", help: "both" });

try {
  process.exitCode = await match(parsed)
    .with({ command: "gen" }, async (p) => await gen(p.out, p.fate, p.requireFate))
    .with({ command: "fetch-fate" }, async (p) => await fetchFateCommand(p.dir, p.mirror))
    .with(
      { command: "classify" },
      async (p) =>
        await classifyCorpus({
          corpus: resolve(p.corpus),
          server: p.server,
          waitSeconds: p.waitSeconds,
          log: (line) => {
            console.log(line);
          },
        })
    )
    .exhaustive();
} catch (error) {
  log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
