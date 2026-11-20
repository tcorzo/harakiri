import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";
import { match } from "ts-pattern";

import { classifyFailure } from "../data/errors";
import type { Failure } from "../data/errors";
import { forgetSession } from "../data/forget";
import { sessionQuery } from "../data/session";
import { QuietAction } from "./actions";
import { focusFirst } from "./focus";
import { Notice } from "./marks";

const wording = (failure: Failure): { readonly title: string; readonly detail: string } =>
  match(failure)
    .with({ kind: "signedOut" }, () => ({
      title: "Signed out by the server",
      detail:
        "The server no longer accepts this device's sign-in. It may have been revoked, or the account changed. Sign in again to carry on.",
    }))
    .with({ kind: "refused" }, () => ({
      title: "The server refused this",
      detail:
        "The server still accepts this device's sign-in, but this account may not open this. Signing in again will not change that; an administrator can change what the account may see.",
    }))
    .with({ kind: "server" }, ({ status }) => ({
      title: "Your server hit an error",
      detail: `Your Jellyfin server answered with an error (${status}). It may be busy or restarting; try again in a moment.`,
    }))
    .with({ kind: "unreachable" }, () => ({
      title: "The server did not answer",
      detail:
        "harakiri could not reach your Jellyfin server. Check that it is running and on the same network, then try again.",
    }))
    .with({ kind: "unexpected" }, () => ({
      title: "Something did not work",
      detail:
        "harakiri hit a problem it did not expect. Try again; if it happens again, the message below says what went wrong.",
    }))
    .exhaustive();

/** A screen whose data could not load: says what happened and offers the way on that fits it. */
export const ErrorScreen = ({ error, reset }: ErrorComponentProps) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const failure = classifyFailure(error);
  const { title, detail } = wording(failure);
  const signedOut = failure.kind === "signedOut";

  useEffect(() => {
    focusFirst("error-first");
  }, []);

  const retry = (): void => {
    reset();
    void router.invalidate();
  };

  // Signing in again keeps the server, so the owner lands on its user list; changing server does not.
  const leave = async (keepServer: boolean): Promise<void> => {
    const server = queryClient.getQueryData(sessionQuery.queryKey)?.serverUrl;
    // A token the server refused (401) is dead; posting a logout with it would only fail again.
    await forgetSession(queryClient, { revoke: !signedOut });
    await router.navigate({
      to: "/onboarding",
      search: keepServer && server !== undefined ? { server } : {},
      replace: true,
    });
  };

  return (
    <main className="bg-ink px-safe-x py-safe-y flex h-screen flex-col justify-end gap-8">
      <h1 className="text-marquee stretch-extra-wide m-0 max-w-[24ch] font-[820] text-balance">
        {title}
      </h1>
      <Notice className="max-w-[62ch]">{detail}</Notice>
      {error instanceof Error ? (
        <p className="text-caption text-paper-faint stretch-condensed">{error.message}</p>
      ) : null}
      <div className="flex gap-6">
        {signedOut ? (
          <QuietAction
            focusKey="error-first"
            label="Sign in again"
            onPress={() => {
              void leave(true);
            }}
          />
        ) : (
          <QuietAction focusKey="error-first" label="Try again" onPress={retry} />
        )}
        <QuietAction
          label="Change server"
          onPress={() => {
            void leave(false);
          }}
        />
      </div>
    </main>
  );
};
