import { createFileRoute } from "@tanstack/react-router";

import { SettingsScreen } from "../../settings/settings-screen";

export const Route = createFileRoute("/_signedIn/settings")({ component: SettingsScreen });
