import type { HdrSignalling } from "@harakiri/fidelity";
import { safeStorage } from "electron";

import type { HostCapabilities } from "./capabilities";
import type { HostFacts } from "./facts";
import { createHost } from "./host";

export type { HostCapabilities, SecretStore } from "./capabilities";

export type { EnvFacts, HostFacts, SecretProbe } from "./facts";

// The environment is read on first use; `safeStorage` only when the secret facts are first asked.
const host = createHost(process.env, safeStorage);

/**
 * This machine's facts, read once. Electron names its secret backend only after `app.whenReady()`.
 * Never rejects, but can wait on the OS keyring: keep it off the path to the window.
 */
export const hostFacts = async (): Promise<HostFacts> => await host.facts();

/** What this machine can do. Call only after `app.whenReady()`; it waits on the keyring probe. */
export const hostCapabilities = async (): Promise<HostCapabilities> => await host.capabilities();

/** How the compositor takes HDR, from the environment alone: it never waits on the keyring. */
export const hostSignalling = (): HdrSignalling => host.signalling();
