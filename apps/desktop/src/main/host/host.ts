import type { HdrSignalling } from "@harakiri/fidelity";

import { capabilitiesOf, hdrSignallingOf } from "./capabilities";
import type { HostCapabilities } from "./capabilities";
import { readEnvFacts, readHostFacts } from "./facts";
import type { EnvFacts, HostFacts, SecretProbe } from "./facts";

/** One machine's facts and capabilities, each read at most once. */
export interface Host {
  readonly facts: () => Promise<HostFacts>;
  readonly capabilities: () => Promise<HostCapabilities>;
  /** Answered from the environment alone: it never waits on the secret store. */
  readonly signalling: () => HdrSignalling;
}

export const createHost = (
  env: Readonly<Record<string, string | undefined>>,
  secrets: SecretProbe
): Host => {
  let envFacts: EnvFacts | undefined;
  let facts: Promise<HostFacts> | undefined;

  const readFacts = async (): Promise<HostFacts> => {
    // `readHostFacts` never rejects, so the memo never holds a failure.
    facts ??= readHostFacts(env, secrets);

    return await facts;
  };

  return {
    facts: readFacts,
    capabilities: async () => capabilitiesOf(await readFacts()),
    signalling: () => {
      envFacts ??= readEnvFacts(env);

      return hdrSignallingOf(envFacts);
    },
  };
};
