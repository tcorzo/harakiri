import { match } from "ts-pattern";

import type { UpdateStatus } from "../../../shared/bridge";

/** The Settings "App" fact: the running version, then what the updater is doing, in the owner's words. */
export function versionLine(version: string, status: UpdateStatus | undefined): string {
  const base = `Version ${version}`;

  if (status === undefined) {
    return base;
  }

  const state = match(status)
    .with({ state: "unsupported" }, () => undefined)
    .with({ state: "idle" }, () => "up to date")
    .with({ state: "available" }, (s) => `${s.version} found, downloads when playback stops`)
    .with({ state: "downloading" }, (s) => `${s.version} downloading ${Math.round(s.percent)}%`)
    .with({ state: "ready" }, (s) => `${s.version} ready, installs when you quit`)
    .with({ state: "failed" }, () => "update failed, tries again later")
    .exhaustive();

  return state === undefined ? base : `${base} · ${state}`;
}
