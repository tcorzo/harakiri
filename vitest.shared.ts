import { configDefaults } from "vitest/config";

/**
 * Test tiers, selected by file name so the default run cannot pick one up by accident:
 * - `*.live.test.ts`: the dev Jellyfin, and they write to it (`mise run test:live`).
 * - `*.contract.test.ts`: the dev Jellyfin with the census library, read only (`mise run test:contract`).
 * - `*.fate.test.ts`: the FFmpeg FATE samples in HARAKIRI_FATE_DIR (`mise run test:fate`).
 * - `*.platform.test.ts`: inside the dev/vm microVM guest (`mise run test:platform`).
 * Every other test file is hermetic and runs in `mise run test`. A tier fails when its
 * dependency is missing; it never skips. vitest.tiers.config.ts runs the tiers.
 */
export const TIERS = {
  live: "**/*.live.test.{ts,tsx}",
  contract: "**/*.contract.test.{ts,tsx}",
  fate: "**/*.fate.test.{ts,tsx}",
  platform: "**/*.platform.test.{ts,tsx}",
} as const;

/** The `exclude` of every package project (apps/desktop spells it out): the defaults plus every tier. */
export const hermeticExclude = [...configDefaults.exclude, ...Object.values(TIERS)];
