import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { appVersion } from "../../../shared/identity";
import { forgetSession } from "../data/forget";
import { useSignedIn } from "../data/session";
import { ListAction } from "../ui/actions";
import { focusFirst } from "../ui/focus";
import { SectionTab } from "../ui/marks";
import { versionLine } from "./version-line";

export const SettingsScreen = () => {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Unsupported means a dev or unpackaged build: nothing will change, so stop asking.
  const updates = useQuery({
    queryKey: ["updates", "status"],
    queryFn: async () => await window.harakiri.updates.status(),
    refetchInterval: (query) => (query.state.data?.state === "unsupported" ? false : 1000),
  });

  const { ref, focusKey } = useFocusable<object, HTMLElement>({
    focusKey: "settings",
    trackChildren: true,
    forceFocus: true,
  });

  useEffect(() => {
    focusFirst("settings-sign-out");
  }, []);

  // Both leave through onboarding; the device id stays, so the server sees the same device again.
  const leave = async (keepServer: boolean): Promise<void> => {
    await forgetSession(queryClient, { revoke: true });
    await navigate({
      to: "/onboarding",
      search: keepServer ? { server: session.serverUrl } : {},
      replace: true,
    });
  };

  return (
    <FocusContext.Provider value={focusKey}>
      <main
        ref={ref}
        aria-label="Settings"
        className="bg-ink px-safe-x py-safe-y flex h-screen gap-10"
      >
        <div className="w-margin flex shrink-0 flex-col items-start gap-6">
          <span className="text-heading stretch-extra-wide font-[820]">harakiri</span>
          <SectionTab>Settings</SectionTab>
        </div>
        <div className="flex max-w-[72rem] flex-1 flex-col pt-[7rem]">
          <h1 className="text-title stretch-extra-wide m-0 mb-10 font-[800]">Settings</h1>
          <dl className="text-body m-0 mb-12 grid grid-cols-[12rem_1fr] gap-x-8 gap-y-3">
            <dt className="text-paper-dim stretch-condensed">Signed in as</dt>
            <dd className="m-0">{session.userName}</dd>
            <dt className="text-paper-dim stretch-condensed">Server</dt>
            <dd className="m-0">
              {session.serverName} · Jellyfin {session.serverVersion}
            </dd>
            <dt className="text-paper-dim stretch-condensed">Address</dt>
            <dd className="stretch-semicondensed m-0">{session.serverUrl}</dd>
            <dt className="text-paper-dim stretch-condensed">App</dt>
            <dd className="m-0" aria-live="polite">
              {versionLine(appVersion, updates.data)}
            </dd>
          </dl>
          <div className="flex flex-col">
            <ListAction
              focusKey="settings-sign-out"
              label="Sign out"
              detail={`Choose another user on ${session.serverName}`}
              onPress={() => void leave(true)}
            />
            <ListAction
              label="Change server"
              detail="Find or type another server"
              onPress={() => void leave(false)}
            />
            {updates.data?.state === "ready" ? (
              <ListAction
                focusKey="settings-restart"
                label="Restart to update"
                detail={`Installs ${updates.data.version} and opens harakiri again`}
                onPress={() => void window.harakiri.updates.restart()}
              />
            ) : null}
          </div>
        </div>
      </main>
    </FocusContext.Provider>
  );
};
