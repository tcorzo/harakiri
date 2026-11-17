import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    HARAKIRI_E2E: z.literal("1").optional(),
    HARAKIRI_USER_DATA: z.string().min(1).optional(),
    /** Where the discovery probe goes instead of the broadcast address, e.g. 127.0.0.1 for a server in a rootless container. */
    HARAKIRI_DISCOVERY_ADDRESS: z.ipv4().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  isServer: true,
});

export const isE2E = env.HARAKIRI_E2E === "1";
