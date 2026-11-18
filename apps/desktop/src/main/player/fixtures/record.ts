// Records PlaybackInfo responses from the dev Jellyfin into this directory, scrubbed of the
// library's paths, names and ids. Pass each fixture as name=itemId; a fixture named
// transcode-bitrate is asked for at a starved bitrate so the server answers with a TranscodingUrl.
// Run from the repo root:
//   mise exec -- bun apps/desktop/src/main/player/fixtures/record.ts dv5-eac3=<itemId> ...
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  AccessToken,
  DeviceId,
  ItemId,
  ServerVersion,
  UserId,
  authorizationHeader,
  playbackInfoRequest,
} from "@harakiri/jellyfin";
import { scrubPlaybackInfo } from "@harakiri/jellyfin/fixture-scrub";
import { authenticateUserByName, getPostedPlaybackInfo } from "@harakiri/jellyfin/generated";
import { createClient } from "@harakiri/jellyfin/generated/client";

const server = process.env["JELLYFIN_DEV_URL"] ?? "http://127.0.0.1:8096";

const identity = {
  client: "harakiri-dev",
  device: "fixture-recorder",
  deviceId: DeviceId.parse("harakiri-fixture-recorder"),
  version: "0",
};

const TRANSCODE_FIXTURE = "transcode-bitrate";

const fixtures = process.argv.slice(2).map((arg) => {
  const [name, itemId] = arg.split("=");

  if (!name || !itemId) {
    throw new Error(`expected name=itemId, got ${arg}`);
  }

  return { name, itemId: ItemId.parse(itemId) };
});

if (fixtures.length === 0) {
  throw new Error("pass at least one fixture as name=itemId");
}

const anonymous = createClient({ baseUrl: server, auth: () => authorizationHeader(identity) });

const { data: auth } = await authenticateUserByName({
  client: anonymous,
  throwOnError: true,
  headers: { Authorization: authorizationHeader(identity) },
  body: {
    Username: process.env["JELLYFIN_DEV_USER"] ?? "harakiri",
    Pw: process.env["JELLYFIN_DEV_PASSWORD"] ?? "harakiri-dev",
  },
});

const token = AccessToken.parse(auth.AccessToken);
const userId = UserId.parse(auth.User?.Id);

const client = createClient({
  baseUrl: server,
  auth: () => authorizationHeader(identity, token),
});

const version = ServerVersion.parse("12.4.0");

const record = async (name: string, itemId: ItemId, maxBitrate?: number) => {
  const body = playbackInfoRequest({ userId, server: version, source: { kind: "default" } });

  if (maxBitrate !== undefined) {
    body.MaxStreamingBitrate = maxBitrate;

    if (body.DeviceProfile) {
      body.DeviceProfile.MaxStreamingBitrate = maxBitrate;
    }
  }

  const { data } = await getPostedPlaybackInfo({
    client,
    throwOnError: true,
    path: { itemId },
    body,
  });

  const json = JSON.stringify(scrubPlaybackInfo({ ...data }, name), null, 2).replaceAll(
    /ApiKey=[0-9a-f]+/g,
    "ApiKey=REDACTED"
  );

  await writeFile(join(import.meta.dirname, `${name}.json`), `${json}\n`);
  console.log(`${name}: ${data.MediaSources?.[0]?.Name ?? "?"}`);
};

for (const { name, itemId } of fixtures) {
  await record(name, itemId, name === TRANSCODE_FIXTURE ? 200_000 : undefined);
}
