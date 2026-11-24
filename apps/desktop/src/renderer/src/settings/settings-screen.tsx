import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { appVersion } from "../../../shared/identity";
import { forgetSession } from "../data/forget";
import { useSignedIn } from "../data/session";
import {
  addOutcomeLine,
  addResultOf,
  isProblem,
  useAddingToLauncher,
  useAddToLauncher,
  useLauncherStatusOnOpen,
} from "../launcher/queries";
import { ListAction } from "../ui/actions";
import { focusFirst } from "../ui/focus";
import { SectionTab } from "../ui/marks";
import { quitLine, updateStatusQuery } from "./quit-line";
import { versionLine } from "./version-line";

/**
 * The launcher action's detail: what it does, that it is waiting, or what went wrong. A problem
 * leads with the problem square, which turns ink with the line when the line inverts on focus.
 */
const LauncherDetail = ({
  line,
  problem,
}: {
  readonly line: string;
  readonly problem: boolean;
}) => (
  <span aria-live="polite" className={problem ? "text-paper group-focus-visible:text-ink" : ""}>
    {problem ? (
      <span
        aria-hidden="true"
        className="bg-alert group-focus-visible:bg-ink mr-3 inline-block size-[0.75em]"
      />
    ) : null}
    {line}
  </span>
);

export const SettingsScreen = () => {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const updates = useQuery(updateStatusQuery);

  // Where the token is kept changes only at a sign-in. Signing out clears the query cache
  // (`data/forget.ts`), so the next session asks again.
  const storage = useQuery({
    queryKey: ["session", "storage"],
    queryFn: async () => await window.harakiri.session.storage(),
    staleTime: Infinity,
  });

  // Offered here whether or not the library's card was put off with Not now.
  const { data: launcher } = useLauncherStatusOnOpen();
  const add = useAddToLauncher();
  const adding = useAddingToLauncher();
  const addResult = addResultOf(add);

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
            <dd className="m-0">
              {session.userName}
              {storage.data === "file" ? (
                <span className="text-caption text-paper-dim stretch-condensed block font-[560]">
                  Signed in on this device without a keyring
                </span>
              ) : null}
            </dd>
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
            {launcher?.state === "added" ? (
              <>
                <dt className="text-paper-dim stretch-condensed">{launcher.name}</dt>
                <dd className="m-0">harakiri is in your library</dd>
              </>
            ) : null}
          </dl>
          <div className="flex flex-col">
            <ListAction
              focusKey="settings-sign-out"
              label="Sign out"
              detail={`Choose another user on ${session.serverName}`}
              onPress={() => {
                void leave(true);
              }}
            />
            <ListAction
              label="Change server"
              detail="Find or type another server"
              onPress={() => {
                void leave(false);
              }}
            />
            {launcher?.state === "offered" ? (
              <ListAction
                focusKey="settings-launcher-add"
                label={`Add to ${launcher.name}`}
                detail={
                  <LauncherDetail
                    line={
                      addOutcomeLine(launcher, addResult, adding) ??
                      `Adds harakiri to your ${launcher.name} library, with its art`
                    }
                    problem={isProblem(addResult, adding)}
                  />
                }
                onPress={() => {
                  if (adding) {
                    return;
                  }

                  add.mutate(undefined, {
                    // Runs once the status has been read again and this line has gone.
                    onSuccess: (added) => {
                      if (added.state === "added") {
                        focusFirst("settings-sign-out");
                      }
                    },
                  });
                }}
              />
            ) : null}
            {updates.data?.state === "ready" ? (
              <ListAction
                focusKey="settings-restart"
                label="Restart to update"
                detail={`Installs ${updates.data.version} and opens harakiri again`}
                onPress={() => {
                  void window.harakiri.updates.restart();
                }}
              />
            ) : null}
            <ListAction
              focusKey="settings-quit"
              label="Quit harakiri"
              detail={quitLine(updates.data)}
              onPress={() => {
                void window.harakiri.app.quit();
              }}
            />
          </div>
        </div>
      </main>
    </FocusContext.Provider>
  );
};
