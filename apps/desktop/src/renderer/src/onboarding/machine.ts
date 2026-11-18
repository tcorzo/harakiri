import { match, P } from "ts-pattern";

import type { Session } from "../../../shared/bridge";

/** What `GET /System/Info/Public` told us about a server that passed validation. */
export interface ServerInfo {
  readonly url: string;
  readonly id: string;
  readonly name: string;
  readonly version: string;
}

export type ServerProblem =
  | { readonly kind: "invalid" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "notJellyfin" }
  | { readonly kind: "tooOld"; readonly version: string };

export type SignInProblem = "wrongPassword" | "rejected" | "unreachable";

export type QuickConnectProblem = "disabled" | "expired" | "unreachable";

export type OnboardingState =
  | { readonly step: "welcome" }
  | { readonly step: "server"; readonly address: string; readonly problem?: ServerProblem }
  | { readonly step: "checking"; readonly address: string; readonly urls: readonly string[] }
  | { readonly step: "chooseUser"; readonly server: ServerInfo }
  | { readonly step: "username"; readonly server: ServerInfo; readonly username: string }
  | {
      readonly step: "password";
      readonly server: ServerInfo;
      readonly username: string;
      readonly password: string;
      readonly problem?: SignInProblem;
    }
  | {
      readonly step: "authenticating";
      readonly server: ServerInfo;
      readonly username: string;
      readonly password: string;
    }
  | {
      readonly step: "quickConnect";
      readonly server: ServerInfo;
      readonly code?: string;
      readonly problem?: QuickConnectProblem;
    }
  | { readonly step: "done"; readonly session: Session };

export type OnboardingEvent =
  | { readonly type: "begin" }
  | { readonly type: "edit"; readonly text: string }
  | { readonly type: "submitAddress" }
  | { readonly type: "pickServer"; readonly address: string }
  | { readonly type: "serverFound"; readonly address: string; readonly info: ServerInfo }
  | { readonly type: "serverFailed"; readonly address: string; readonly problem: ServerProblem }
  | { readonly type: "pickUser"; readonly username: string; readonly hasPassword: boolean }
  | { readonly type: "otherUser" }
  | { readonly type: "submitUsername" }
  | { readonly type: "submitPassword" }
  | { readonly type: "signInFailed"; readonly problem: SignInProblem }
  | { readonly type: "startQuickConnect" }
  | { readonly type: "quickConnectCode"; readonly code: string }
  | { readonly type: "quickConnectFailed"; readonly problem: QuickConnectProblem }
  | { readonly type: "signedIn"; readonly session: Session }
  | { readonly type: "back" };

export const initialOnboarding: OnboardingState = { step: "welcome" };

/** Jellyfin's default HTTP port, tried when the owner types a bare host. */
const defaultPort = "8096";

const scheme = /^[a-z][a-z0-9+.-]*:\/\//i;

function baseUrl(url: URL): string {
  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;

  return `${url.protocol}//${url.host}${path}`;
}

/**
 * Turns what the owner typed into the base URLs it could mean, or null when it cannot be one.
 * A typed scheme is taken as is. Without one, a bare host is tried over HTTPS on 443 (a server
 * behind a reverse proxy) and over HTTP on Jellyfin's own port; a host with a port, over both.
 */
export function serverCandidates(typed: string): readonly string[] | null {
  const trimmed = typed.trim();

  if (trimmed === "") {
    return null;
  }
  const typedScheme = scheme.test(trimmed);
  let url: URL;

  try {
    url = new URL(typedScheme ? trimmed : `http://${trimmed}`);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  if (url.hostname === "") {
    return null;
  }

  if (typedScheme) {
    return [baseUrl(url)];
  }
  const secure = new URL(url);
  secure.protocol = "https:";

  if (url.port === "") {
    url.port = defaultPort;
  }

  return [baseUrl(secure), baseUrl(url)];
}

/** The oldest server whose API harakiri's device profile and Quick Connect calls are written against. */
export const minimumServer = { major: 10, minor: 10 } as const;

export function isServerSupported(version: string): boolean {
  const found = /^(\d+)\.(\d+)/.exec(version);

  if (found === null) {
    return false;
  }
  const major = Number(found[1]);
  const minor = Number(found[2]);

  return (
    major > minimumServer.major || (major === minimumServer.major && minor >= minimumServer.minor)
  );
}

function checking(address: string): OnboardingState {
  const urls = serverCandidates(address);

  return urls === null
    ? { step: "server", address, problem: { kind: "invalid" } }
    : { step: "checking", address, urls };
}

export function onboarding(state: OnboardingState, event: OnboardingEvent): OnboardingState {
  return match<[OnboardingState, OnboardingEvent], OnboardingState>([state, event])
    .with([{ step: "welcome" }, { type: "begin" }], () => ({ step: "server", address: "" }))
    .with([{ step: "server" }, { type: "edit" }], ([, { text }]) => ({
      step: "server",
      address: text,
    }))
    .with([{ step: "server" }, { type: "submitAddress" }], ([s]) => checking(s.address))
    .with([{ step: "server" }, { type: "pickServer" }], ([, e]) => checking(e.address))
    .with([{ step: "checking" }, { type: "serverFound" }], ([s, e]) =>
      e.address === s.address ? { step: "chooseUser", server: e.info } : s
    )
    .with([{ step: "checking" }, { type: "serverFailed" }], ([s, e]) =>
      e.address === s.address ? { step: "server", address: s.address, problem: e.problem } : s
    )
    .with([{ step: "chooseUser" }, { type: "pickUser" }], ([s, e]) => ({
      step: e.hasPassword ? "password" : "authenticating",
      server: s.server,
      username: e.username,
      password: "",
    }))
    .with([{ step: "chooseUser" }, { type: "otherUser" }], ([s]) => ({
      step: "username",
      server: s.server,
      username: "",
    }))
    .with([{ step: "chooseUser" }, { type: "startQuickConnect" }], ([s]) => ({
      step: "quickConnect",
      server: s.server,
    }))
    .with([{ step: "username" }, { type: "edit" }], ([s, e]) => ({ ...s, username: e.text }))
    .with([{ step: "username" }, { type: "submitUsername" }], ([s]) =>
      s.username.trim() === ""
        ? s
        : { step: "password", server: s.server, username: s.username.trim(), password: "" }
    )
    .with([{ step: "password" }, { type: "edit" }], ([s, e]) => ({
      step: "password",
      server: s.server,
      username: s.username,
      password: e.text,
    }))
    .with([{ step: "password" }, { type: "submitPassword" }], ([s]) => ({
      step: "authenticating",
      server: s.server,
      username: s.username,
      password: s.password,
    }))
    .with([{ step: "authenticating" }, { type: "signInFailed" }], ([s, e]) => ({
      step: "password",
      server: s.server,
      username: s.username,
      password: "",
      problem: e.problem,
    }))
    .with([{ step: P.union("authenticating", "quickConnect") }, { type: "signedIn" }], ([, e]) => ({
      step: "done",
      session: e.session,
    }))
    .with([{ step: "quickConnect" }, { type: "quickConnectCode" }], ([s, e]) => ({
      step: "quickConnect",
      server: s.server,
      code: e.code,
    }))
    .with([{ step: "quickConnect" }, { type: "quickConnectFailed" }], ([s, e]) => ({
      step: "quickConnect",
      server: s.server,
      problem: e.problem,
    }))
    .with([P._, { type: "back" }], ([s]) => back(s))
    .otherwise(([s]) => s);
}

function back(state: OnboardingState): OnboardingState {
  return match<OnboardingState, OnboardingState>(state)
    .with({ step: P.union("welcome", "done") }, (s) => s)
    .with({ step: "server" }, () => ({ step: "welcome" }))
    .with({ step: "checking" }, (s) => ({ step: "server", address: s.address }))
    .with({ step: "chooseUser" }, (s) => ({ step: "server", address: s.server.url }))
    .with({ step: P.union("username", "password", "quickConnect") }, (s) => ({
      step: "chooseUser",
      server: s.server,
    }))
    .with({ step: "authenticating" }, (s) => ({
      step: "password",
      server: s.server,
      username: s.username,
      password: s.password,
    }))
    .exhaustive();
}
