import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { OnboardingScreen } from "../onboarding/OnboardingScreen";

export const Route = createFileRoute("/onboarding")({
  // Signing out returns here with the server already known, so the owner lands on the user list.
  validateSearch: z.object({ server: z.string().optional().catch(undefined) }),
  component: OnboardingScreen,
});
