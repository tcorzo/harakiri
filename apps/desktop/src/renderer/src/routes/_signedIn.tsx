import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { sessionQuery, signedIn } from "../data/session";

export const Route = createFileRoute("/_signedIn")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session === null) throw redirect({ to: "/onboarding" });
    return { signedIn: signedIn(session) };
  },
  component: Outlet,
});
