import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { appVersion } from "../../../shared/identity";
import { forgetSession } from "../data/forget";
import { useSignedIn } from "../data/session";
import { ListAction } from "../ui/actions";
import { focusFirst } from "../ui/focus";

export function SettingsScreen() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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
        className="flex h-screen gap-10 bg-ink px-safe-x py-safe-y"
      >
        <div className="flex w-margin shrink-0 flex-col items-start gap-6">
          <span className="text-heading font-[820] stretch-extra-wide">harakiri</span>
          <div className="flex min-h-[16rem] w-[3.5rem] flex-1 items-end justify-center bg-band pb-4">
            <span className="rotate-180 text-body font-[760] whitespace-nowrap text-paper stretch-wide [writing-mode:vertical-rl]">
              Settings
            </span>
          </div>
        </div>
        <div className="flex max-w-[72rem] flex-1 flex-col pt-[7rem]">
          <h1 className="m-0 mb-10 text-title font-[800] stretch-extra-wide">Settings</h1>
          <dl className="m-0 mb-12 grid grid-cols-[12rem_1fr] gap-x-8 gap-y-3 text-body">
            <dt className="text-paper-dim stretch-condensed">Signed in as</dt>
            <dd className="m-0">{session.userName}</dd>
            <dt className="text-paper-dim stretch-condensed">Server</dt>
            <dd className="m-0">
              {session.serverName} · Jellyfin {session.serverVersion}
            </dd>
            <dt className="text-paper-dim stretch-condensed">Address</dt>
            <dd className="m-0 stretch-semicondensed">{session.serverUrl}</dd>
            <dt className="text-paper-dim stretch-condensed">App</dt>
            <dd className="m-0">Version {appVersion}</dd>
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
          </div>
        </div>
      </main>
    </FocusContext.Provider>
  );
}
