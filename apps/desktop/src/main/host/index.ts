import { safeStorage } from "electron";

import { capabilitiesOf } from "./capabilities";
import type { HostCapabilities } from "./capabilities";
import { readHostFacts } from "./facts";
import type { HostFacts } from "./facts";

export type { HostCapabilities, SecretStore } from "./capabilities";

export type { HostFacts, SecretProbe } from "./facts";

let facts: Promise<HostFacts> | undefined;

/** This machine's facts, read once. Electron names its secret backend only after `app.whenReady()`. */
export const hostFacts = async (): Promise<HostFacts> => {
  facts ??= readHostFacts(process.env, safeStorage);

  return await facts;
};

/** What this machine can do. Call only after `app.whenReady()`. */
export const hostCapabilities = async (): Promise<HostCapabilities> =>
  capabilitiesOf(await hostFacts());
