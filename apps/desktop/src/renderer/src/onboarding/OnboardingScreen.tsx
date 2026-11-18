import { publicUsersQuery, ServerUrl } from "@harakiri/jellyfin";
import type { ClientIdentity } from "@harakiri/jellyfin";
import {
  FocusContext,
  getCurrentFocusKey,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useReducer, useState } from "react";
import type { ReactNode } from "react";
import { match } from "ts-pattern";

import type { Session } from "../../../shared/bridge";
import { clientIdentity } from "../../../shared/identity";
import { sessionQuery } from "../data/session";
import { activity } from "../input/activity";
import { useActionHandler } from "../input/handlers";
import { ListAction, QuietAction } from "../ui/actions";
import { focusFirst } from "../ui/focus";
import { EntryField, firstKey, Keyboard } from "../ui/keyboard";
import { Notice, SectionTab } from "../ui/marks";
import { initialOnboarding, minimumServer, onboarding, serverCandidates } from "./machine";
import type {
  OnboardingEvent,
  OnboardingState,
  QuickConnectProblem,
  ServerInfo,
  ServerProblem,
  SignInProblem,
} from "./machine";
import { checkServer, quickConnectEnabled, runQuickConnect, signIn } from "./server";

type Send = (event: OnboardingEvent) => void;

const route = getRouteApi("/onboarding");

interface Flow {
  readonly state: OnboardingState;
  readonly send: Send;
  readonly identity: ClientIdentity;
  readonly finish: (session: Session) => Promise<void>;
}

function Frame({
  step,
  title,
  children,
}: {
  readonly step: string | null;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <main aria-label={title} className="bg-ink px-safe-x py-safe-y flex h-screen gap-10">
      <div className="w-margin flex shrink-0 flex-col items-start gap-6">
        <span className="text-heading stretch-extra-wide font-[820]">harakiri</span>
        {step === null ? null : <SectionTab>{step}</SectionTab>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col pt-[7rem]">{children}</div>
    </main>
  );
}

function Heading({
  children,
  detail,
}: {
  readonly children: ReactNode;
  readonly detail?: ReactNode;
}) {
  return (
    <header className="mb-10 flex flex-col gap-3">
      <h1 className="text-title stretch-extra-wide m-0 font-[800] text-balance">{children}</h1>
      {detail === undefined ? null : (
        <p className="text-body text-paper-dim max-w-[62ch]">{detail}</p>
      )}
    </header>
  );
}

function Problem({ children }: { readonly children: ReactNode }) {
  return <Notice className="max-w-[56ch]">{children}</Notice>;
}

function serverProblemText(problem: ServerProblem, address: string): string {
  return match(problem)
    .with(
      { kind: "invalid" },
      () =>
        "That is not an address harakiri can use. Type a host name or IP, such as 192.168.1.20 or jellyfin.local."
    )
    .with(
      { kind: "unreachable" },
      () =>
        `Nothing answered at ${address}. Check the address, and that the server is on and on this network.`
    )
    .with(
      { kind: "notJellyfin" },
      () => `Something answered at ${address}, but it is not a Jellyfin server.`
    )
    .with(
      { kind: "tooOld" },
      (p) =>
        `This server runs Jellyfin ${p.version}. harakiri needs ${minimumServer.major}.${minimumServer.minor} or newer. Update the server, then try again.`
    )
    .exhaustive();
}

function signInProblemText(problem: SignInProblem, username: string): string {
  return match(problem)
    .with(
      "wrongPassword",
      () =>
        `That password did not work for ${username}. Try again, or press Back to choose another user.`
    )
    .with(
      "rejected",
      () =>
        "The server refused this sign-in. The account may be disabled; ask whoever runs the server."
    )
    .with(
      "unreachable",
      () => "The server stopped answering. Press Back and check that it is still on."
    )
    .exhaustive();
}

function quickConnectProblemText(problem: QuickConnectProblem): string {
  return match(problem)
    .with(
      "disabled",
      () => "Quick Connect is switched off on this server. Press Back and sign in with a password."
    )
    .with("expired", () => "That code expired. Press Back and start Quick Connect again.")
    .with(
      "unreachable",
      () => "The server stopped answering. Press Back and check that it is still on."
    )
    .exhaustive();
}

function Welcome({ send }: { readonly send: Send }) {
  useEffect(() => {
    focusFirst("welcome-begin");
  }, []);

  return (
    <main
      aria-label="Welcome"
      className="bg-ink px-safe-x py-safe-y relative flex h-screen flex-col justify-end"
    >
      <div aria-hidden="true" className="left-safe-x bg-band absolute top-0 bottom-0 w-[3.5rem]" />
      <div className="relative flex flex-col gap-10 pb-[6rem] pl-[calc(var(--spacing-margin)+2.5rem)]">
        <h1 className="stretch-extra-wide m-0 text-[9rem] leading-[0.9] font-[860] tracking-[-0.02em]">
          harakiri
        </h1>
        <p className="text-heading text-paper-dim stretch-semicondensed max-w-[40ch] font-[460]">
          A screening room for your Jellyfin library. Every file plays as it is.
        </p>
        <div>
          <QuietAction
            focusKey="welcome-begin"
            label="Begin"
            onPress={() => {
              send({ type: "begin" });
            }}
          >
            Begin
          </QuietAction>
        </div>
      </div>
    </main>
  );
}

const searchAgainKey = "server-search-again";

function DiscoveredList({ onPick }: { readonly onPick: (address: string) => void }) {
  const discovery = useQuery({
    queryKey: ["discover"],
    queryFn: async () => window.harakiri.discover(),
    staleTime: 0,
  });

  const servers = discovery.data ?? [];
  const firstAddress = servers[0]?.address;
  const [shownAt] = useState(() => Date.now());

  // A server found while the owner sits untouched takes focus, as does one found by "Search again";
  // one that answers while they are already typing an address must not pull focus out of the keyboard.
  useEffect(() => {
    if (firstAddress === undefined) {
      return;
    }
    const untouched = activity.getState().at < shownAt;

    if (untouched || getCurrentFocusKey() === searchAgainKey) {
      focusFirst("server-found-0");
    }
  }, [firstAddress, shownAt]);

  return (
    <section aria-label="Servers on this network" className="flex flex-col gap-4">
      <h2 className="text-heading stretch-wide m-0 font-[760]">On this network</h2>
      {match(discovery)
        .with({ status: "pending" }, () => (
          <p aria-live="polite" className="text-body text-paper-dim">
            Listening for servers…
          </p>
        ))
        .otherwise(() =>
          servers.length === 0 ? (
            <div className="flex flex-col items-start gap-4">
              <p className="text-body text-paper-dim max-w-[40ch]">
                No server answered. Type its address instead, or search again.
              </p>
              <QuietAction
                focusKey={searchAgainKey}
                label="Search again"
                onPress={() => void discovery.refetch()}
              />
            </div>
          ) : (
            <div className="flex flex-col">
              {servers.map((server, i) => (
                <ListAction
                  key={server.id}
                  focusKey={`server-found-${i}`}
                  label={`${server.name}, ${server.address}`}
                  detail={server.address}
                  onPress={() => {
                    onPick(server.address);
                  }}
                >
                  {server.name}
                </ListAction>
              ))}
            </div>
          )
        )}
    </section>
  );
}

function ServerStep({ state, send }: Flow) {
  const queryClient = useQueryClient();
  const address = state.step === "server" || state.step === "checking" ? state.address : "";

  const check = async (typed: string, event: OnboardingEvent): Promise<void> => {
    send(event);
    const urls = serverCandidates(typed);

    if (urls === null) {
      return;
    }
    const result = await checkServer(queryClient, urls);
    send(
      result.ok
        ? { type: "serverFound", address: typed, info: result.info }
        : { type: "serverFailed", address: typed, problem: result.problem }
    );
  };

  useEffect(() => {
    focusFirst(firstKey("address"));
  }, []);

  return (
    <Frame step="Server" title="Find your server">
      <Heading detail="Pick a server harakiri found on your network, or type its address below, for example 192.168.1.20 or jellyfin.example.com. Without http:// or https://, harakiri tries HTTPS, then Jellyfin's port 8096.">
        Find your server
      </Heading>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-16">
        <DiscoveredList
          onPick={(picked) => void check(picked, { type: "pickServer", address: picked })}
        />
        <div className="flex flex-col gap-6">
          <EntryField
            focusKey="address-field"
            label="Server address"
            value={address}
            masked={false}
            onChange={(text) => {
              send({ type: "edit", text });
            }}
            onSubmit={() => void check(address, { type: "submitAddress" })}
          />
          <div className="min-h-[4.5rem]" aria-live="polite">
            {state.step === "checking" ? (
              <p className="text-body text-paper-dim">Checking {state.address.trim()}…</p>
            ) : state.step === "server" && state.problem !== undefined ? (
              <Problem>{serverProblemText(state.problem, state.address)}</Problem>
            ) : null}
          </div>
          <Keyboard
            focusKey="address"
            layout="address"
            value={address}
            onChange={(text) => {
              send({ type: "edit", text });
            }}
            onSubmit={() => void check(address, { type: "submitAddress" })}
            submitLabel="Connect"
          />
        </div>
      </div>
    </Frame>
  );
}

function ChooseUser({
  server,
  send,
  identity,
}: {
  readonly server: ServerInfo;
  readonly send: Send;
  readonly identity: ClientIdentity;
}) {
  const users = useQuery(publicUsersQuery(ServerUrl.parse(server.url)));

  const qc = useQuery({
    queryKey: ["quickConnectEnabled", server.url],
    queryFn: async () => quickConnectEnabled(server, identity),
  });

  const ready = users.status !== "pending";

  useEffect(() => {
    if (ready) {
      focusFirst("user-0");
    }
  }, [ready]);

  const listed = users.data ?? [];

  return (
    <Frame
      step="Sign in"
      title={listed.length === 0 ? `Sign in to ${server.name}` : "Who is watching"}
    >
      <Heading detail={`${server.name} · Jellyfin ${server.version}`}>
        {listed.length === 0 ? `Sign in to ${server.name}` : "Who is watching?"}
      </Heading>
      <div className="flex max-w-[64rem] flex-col">
        {listed.map((user, i) => (
          <ListAction
            key={user.Id ?? user.Name ?? i}
            focusKey={`user-${i}`}
            label={user.Name ?? "User"}
            detail={user.HasPassword === false ? "No password" : "Password"}
            onPress={() => {
              send({
                type: "pickUser",
                username: user.Name ?? "",
                hasPassword: user.HasPassword !== false,
              });
            }}
          />
        ))}
        <ListAction
          focusKey={`user-${listed.length === 0 ? 0 : listed.length}`}
          label="Another user"
          detail="Type a user name"
          onPress={() => {
            send({ type: "otherUser" });
          }}
        />
        {qc.data === true ? (
          <ListAction
            label="Quick Connect"
            detail="Approve a code from another device"
            onPress={() => {
              send({ type: "startQuickConnect" });
            }}
          />
        ) : null}
      </div>
    </Frame>
  );
}

function UsernameStep({ username, send }: { readonly username: string; readonly send: Send }) {
  useEffect(() => {
    focusFirst(firstKey("username"));
  }, []);

  return (
    <Frame step="Sign in" title="Your user name">
      <Heading>Your user name</Heading>
      <div className="flex max-w-[72rem] flex-col gap-8">
        <EntryField
          focusKey="username-field"
          label="User name"
          value={username}
          masked={false}
          onChange={(text) => {
            send({ type: "edit", text });
          }}
          onSubmit={() => {
            send({ type: "submitUsername" });
          }}
        />
        <Keyboard
          focusKey="username"
          layout="text"
          value={username}
          onChange={(text) => {
            send({ type: "edit", text });
          }}
          onSubmit={() => {
            send({ type: "submitUsername" });
          }}
          submitLabel="Next"
        />
      </div>
    </Frame>
  );
}

function PasswordStep({
  flow,
  state,
}: {
  readonly flow: Flow;
  readonly state: Extract<OnboardingState, { step: "password" | "authenticating" }>;
}) {
  const { send } = flow;
  useEffect(() => {
    focusFirst(firstKey("password"));
  }, []);

  return (
    <Frame step="Sign in" title={`Password for ${state.username}`}>
      <Heading detail={`${state.server.name} · Jellyfin ${state.server.version}`}>
        Sign in as {state.username}
      </Heading>
      <div className="flex max-w-[72rem] flex-col gap-6">
        <EntryField
          focusKey="password-field"
          label="Password"
          value={state.password}
          masked
          onChange={(text) => {
            send({ type: "edit", text });
          }}
          onSubmit={() => {
            send({ type: "submitPassword" });
          }}
        />
        <div className="min-h-[4.5rem]" aria-live="polite">
          {state.step === "authenticating" ? (
            <p className="text-body text-paper-dim">Signing in…</p>
          ) : state.problem === undefined ? null : (
            <Problem>{signInProblemText(state.problem, state.username)}</Problem>
          )}
        </div>
        <Keyboard
          focusKey="password"
          layout="text"
          value={state.password}
          onChange={(text) => {
            send({ type: "edit", text });
          }}
          onSubmit={() => {
            send({ type: "submitPassword" });
          }}
          submitLabel="Sign in"
        />
      </div>
      {state.step === "authenticating" ? <SignIn {...flow} state={state} /> : null}
    </Frame>
  );
}

/**
 * Signs in with what the password step holds; a user without a password arrives here straight from
 * the list. It renders nothing: the password step stays mounted around it, so a wrong password
 * keeps the keyboard where the owner left it.
 */
function SignIn({
  state,
  send,
  identity,
  finish,
}: Flow & { readonly state: Extract<OnboardingState, { step: "authenticating" }> }) {
  const { server, username, password } = state;
  useEffect(() => {
    let live = true;
    void signIn(server, identity, username, password).then(async (result) => {
      if (!live) {
        return;
      }

      if (result.ok) {
        await finish(result.session);
      } else {
        send({ type: "signInFailed", problem: result.problem });
      }
    });

    return () => {
      live = false;
    };
  }, [server, username, password, identity, finish, send]);

  return null;
}

function QuickConnectStep({
  state,
  send,
  identity,
  finish,
}: Flow & { readonly state: Extract<OnboardingState, { step: "quickConnect" }> }) {
  const { server } = state;
  useEffect(() => {
    const abort = new AbortController();
    void runQuickConnect(server, identity, abort.signal, (outcome) => {
      if (abort.signal.aborted) {
        return;
      }
      match(outcome)
        .with({ kind: "code" }, (o) => {
          send({ type: "quickConnectCode", code: o.code });
        })
        .with({ kind: "failed" }, (o) => {
          send({ type: "quickConnectFailed", problem: o.problem });
        })
        .with({ kind: "signedIn" }, (o) => void finish(o.session))
        .exhaustive();
    });

    return () => {
      abort.abort();
    };
  }, [server, identity, send, finish]);

  useEffect(() => {
    focusFirst("quick-connect-back");
  }, []);

  return (
    <Frame step="Sign in" title="Quick Connect">
      <Heading detail="On a device already signed in to this server, open Quick Connect in the user menu and enter this code.">
        Quick Connect
      </Heading>
      {state.problem !== undefined ? (
        <Problem>{quickConnectProblemText(state.problem)}</Problem>
      ) : state.code === undefined ? (
        <p className="text-body text-paper-dim">Asking the server for a code…</p>
      ) : (
        <p
          aria-label={`Code ${state.code.split("").join(" ")}`}
          className="stretch-condensed text-[8rem] leading-none font-[300] tracking-[0.18em]"
        >
          {state.code}
        </p>
      )}
      <div className="mt-12">
        <QuietAction
          focusKey="quick-connect-back"
          label="Use a password instead"
          onPress={() => {
            send({ type: "back" });
          }}
        />
      </div>
    </Frame>
  );
}

const deviceIdQuery = {
  queryKey: ["deviceId"],
  queryFn: async () => window.harakiri.deviceId(),
  staleTime: Infinity,
} as const;

/** The main process owns the device id, so the session and every request name the same device. */
function useIdentity(): ClientIdentity {
  const { data } = useSuspenseQuery({ ...deviceIdQuery, select: clientIdentity });

  return data;
}

export function OnboardingScreen() {
  const { server: knownServer } = route.useSearch();

  const [state, send] = useReducer(onboarding, knownServer, (address): OnboardingState =>
    address === undefined
      ? initialOnboarding
      : onboarding({ step: "server", address }, { type: "submitAddress" })
  );

  const identity = useIdentity();
  const queryClient = useQueryClient();
  const resumeCheck = state.step === "checking" && knownServer !== undefined ? state : null;
  const resumeAddress = resumeCheck?.address;
  const resumeUrls = resumeCheck?.urls;

  useEffect(() => {
    if (resumeAddress === undefined || resumeUrls === undefined) {
      return;
    }
    void checkServer(queryClient, resumeUrls).then((result) => {
      send(
        result.ok
          ? { type: "serverFound", address: resumeAddress, info: result.info }
          : { type: "serverFailed", address: resumeAddress, problem: result.problem }
      );
    });
  }, [resumeAddress, resumeUrls, queryClient]);
  const navigate = useNavigate();

  const { ref, focusKey } = useFocusable<object, HTMLDivElement>({
    focusKey: "onboarding",
    trackChildren: true,
    forceFocus: true,
  });

  useActionHandler("back", () => {
    send({ type: "back" });
  });

  const [finish] = useState(() => async (session: Session): Promise<void> => {
    const { deviceId: _ownedByMain, ...fresh } = session;
    await window.harakiri.session.save(fresh);
    queryClient.setQueryData(sessionQuery.queryKey, session);
    send({ type: "signedIn", session });
    await navigate({ to: "/library", replace: true });
  });

  const flow: Flow = { state, send, identity, finish };

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref}>
        {match(state)
          .with({ step: "welcome" }, () => <Welcome send={send} />)
          .with({ step: "server" }, { step: "checking" }, () => <ServerStep {...flow} />)
          .with({ step: "chooseUser" }, (s) => (
            <ChooseUser server={s.server} send={send} identity={identity} />
          ))
          .with({ step: "username" }, (s) => <UsernameStep username={s.username} send={send} />)
          .with({ step: "password" }, { step: "authenticating" }, (s) => (
            <PasswordStep flow={flow} state={s} />
          ))
          .with({ step: "quickConnect" }, (s) => <QuickConnectStep {...flow} state={s} />)
          .with({ step: "done" }, () => null)
          .exhaustive()}
      </div>
    </FocusContext.Provider>
  );
}
