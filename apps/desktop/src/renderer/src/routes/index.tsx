import { createFileRoute, redirect } from "@tanstack/react-router";

import { sessionQuery } from "../data/session";

export const Route = createFileRoute("/")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.query({ ...sessionQuery, staleTime: "static" });
    throw redirect({ to: session === null ? "/onboarding" : "/library" });
  },
});
