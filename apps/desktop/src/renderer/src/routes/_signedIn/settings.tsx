import { createFileRoute } from "@tanstack/react-router";

import { SettingsScreen } from "../../settings/SettingsScreen";

export const Route = createFileRoute("/_signedIn/settings")({ component: SettingsScreen });
