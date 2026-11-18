import type { AccessToken, DeviceId, ItemId, MediaSourceId, ServerUrl } from "./ids";

export type StaticStream = {
  readonly server: ServerUrl;
  readonly itemId: ItemId;
  readonly mediaSourceId: MediaSourceId;
};

// static=true is a byte-exact passthrough with range support, so mpv seeks natively.
export const staticStreamUrl = ({ server, itemId, mediaSourceId }: StaticStream): string => {
  const url = new URL(`Videos/${itemId}/stream`, server);
  url.search = new URLSearchParams({ static: "true", MediaSourceId: mediaSourceId }).toString();

  return url.toString();
};

export type ClientIdentity = {
  readonly client: string;
  readonly device: string;
  readonly deviceId: DeviceId;
  readonly version: string;
};

// The server URL-decodes each value, and a raw quote would end the field early.
export const authorizationHeader = (identity: ClientIdentity, token?: AccessToken): string => {
  const fields = {
    Client: identity.client,
    Device: identity.device,
    DeviceId: identity.deviceId,
    Version: identity.version,
    ...(token === undefined ? {} : { Token: token }),
  };

  const parts = Object.entries(fields).map(
    ([key, value]) => `${key}="${encodeURIComponent(value)}"`
  );

  return `MediaBrowser ${parts.join(", ")}`;
};

// One element of mpv's http-header-fields list. The value contains commas, so it
// must be appended as a single list item, never passed as a comma-split string.
export const mpvAuthorizationHeaderField = (identity: ClientIdentity, token: AccessToken): string =>
  `Authorization: ${authorizationHeader(identity, token)}`;
