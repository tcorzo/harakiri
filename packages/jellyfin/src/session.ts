import { z } from "zod";

import { createClient } from "./generated/client";
import type { Client } from "./generated/client";
import {
  authenticateUserByName,
  authenticateWithQuickConnect as quickConnectAuthenticate,
  getPublicSystemInfo,
  getQuickConnectEnabled,
  getQuickConnectState,
  initiateQuickConnect as quickConnectInitiate,
} from "./generated/sdk.gen";
import type { DeviceId, ServerUrl } from "./ids";
import { AccessToken, UserId } from "./ids";
import { authorizationHeader } from "./stream-url";
import type { ClientIdentity } from "./stream-url";

/** Everything the desktop app's Session needs, with ids branded. */
export interface SessionData {
  readonly serverUrl: ServerUrl;
  readonly serverId: string;
  readonly serverName: string;
  readonly serverVersion: string;
  readonly userId: UserId;
  readonly userName: string;
  readonly accessToken: AccessToken;
  readonly deviceId: DeviceId;
}

export type SignInResult =
  | { readonly kind: "signed-in"; readonly session: SessionData }
  | { readonly kind: "wrong-credentials" }
  /** The server answered but refused the client, or sent something unusable. */
  | { readonly kind: "rejected"; readonly status: number }
  | { readonly kind: "unreachable"; readonly message: string };

export interface QuickConnectCode {
  /** Shown to the owner, who approves it from another signed-in device. */
  readonly code: string;
  readonly secret: string;
}

/**
 * A generated-SDK client that sends the MediaBrowser Authorization header on
 * every request. Jellyfin needs the client fields even on anonymous endpoints
 * such as AuthenticateByName, which the spec does not mark as secured.
 */
export const createJellyfinClient = (
  server: ServerUrl,
  identity: ClientIdentity,
  token?: AccessToken
): Client =>
  createClient({
    baseUrl: server.replace(/\/$/u, ""),
    headers: { Authorization: authorizationHeader(identity, token) },
  });

const SignedIn = z.object({
  AccessToken,
  ServerId: z.string().min(1),
  User: z.object({ Id: UserId, Name: z.string() }),
});

const ServerInfo = z.object({
  Id: z.string().min(1),
  ServerName: z.string(),
  Version: z.string().min(1),
});

interface Answer {
  readonly data?: unknown;
  readonly error?: unknown;
  readonly response?: Response;
}

const FailureMessage = z
  .unknown()
  .transform((failure) => (failure instanceof Error ? failure.message : String(failure)));

const toSession = async (
  server: ServerUrl,
  identity: ClientIdentity,
  client: Client,
  signIn: Promise<Answer>
): Promise<SignInResult> => {
  let answers: [Answer, Answer];

  try {
    answers = await Promise.all([signIn, getPublicSystemInfo({ client })]);
  } catch (error) {
    return { kind: "unreachable", message: FailureMessage.parse(error) };
  }

  const [auth, info] = answers;

  // Without throwOnError the generated client reports a network failure as a missing response.
  for (const answer of answers) {
    if (answer.response === undefined) {
      return { kind: "unreachable", message: FailureMessage.parse(answer.error) };
    }
  }

  const authStatus = auth.response?.status ?? 0;

  if (authStatus === 401) {
    return { kind: "wrong-credentials" };
  }

  if (auth.response?.ok !== true) {
    return { kind: "rejected", status: authStatus };
  }

  if (info.response?.ok !== true) {
    return { kind: "rejected", status: info.response?.status ?? 0 };
  }

  const signedIn = SignedIn.safeParse(auth.data);
  const serverInfo = ServerInfo.safeParse(info.data);

  if (!signedIn.success || !serverInfo.success) {
    return { kind: "rejected", status: authStatus };
  }

  return {
    kind: "signed-in",
    session: {
      serverUrl: server,
      serverId: serverInfo.data.Id,
      serverName: serverInfo.data.ServerName,
      serverVersion: serverInfo.data.Version,
      userId: signedIn.data.User.Id,
      userName: signedIn.data.User.Name,
      accessToken: signedIn.data.AccessToken,
      deviceId: identity.deviceId,
    },
  };
};

export const authenticate = async (
  server: ServerUrl,
  username: string,
  password: string,
  identity: ClientIdentity
): Promise<SignInResult> => {
  const client = createJellyfinClient(server, identity);

  return await toSession(
    server,
    identity,
    client,
    authenticateUserByName({ client, body: { Username: username, Pw: password } })
  );
};

export const quickConnectEnabled = async (
  server: ServerUrl,
  identity: ClientIdentity
): Promise<boolean> => {
  const client = createJellyfinClient(server, identity);
  const { data } = await getQuickConnectEnabled({ client, throwOnError: true });

  return data;
};

export const initiateQuickConnect = async (
  server: ServerUrl,
  identity: ClientIdentity
): Promise<QuickConnectCode> => {
  const client = createJellyfinClient(server, identity);
  const { data } = await quickConnectInitiate({ client, throwOnError: true });

  return z.object({ code: z.string(), secret: z.string() }).parse({
    code: data.Code,
    secret: data.Secret,
  });
};

/** True once the owner has approved the code on another device. */
export const pollQuickConnect = async (
  server: ServerUrl,
  identity: ClientIdentity,
  secret: string
): Promise<boolean> => {
  const client = createJellyfinClient(server, identity);
  const { data } = await getQuickConnectState({ client, throwOnError: true, query: { secret } });

  return data.Authenticated === true;
};

export const authenticateWithQuickConnect = async (
  server: ServerUrl,
  identity: ClientIdentity,
  secret: string
): Promise<SignInResult> => {
  const client = createJellyfinClient(server, identity);

  return await toSession(
    server,
    identity,
    client,
    quickConnectAuthenticate({ client, body: { Secret: secret } })
  );
};
