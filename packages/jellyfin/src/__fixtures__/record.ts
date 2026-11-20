/// <reference types="node" />
// Records trimmed MediaSources from the dev Jellyfin, scrubbed of the library's ids and credits.
// Pass each fixture as name=searchTerm, a term that finds exactly one movie or episode.
// Run from the repo root:
//   mise exec -- bun packages/jellyfin/src/__fixtures__/record.ts dv5-eac3=<search term> ...
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { zMediaSourceInfo, zMediaStream } from "../generated/zod.gen";
import { scrubSource } from "./scrub";

const server = process.env.JELLYFIN_DEV_URL ?? "http://127.0.0.1:8096";

const identity =
  'MediaBrowser Client="harakiri-dev", Device="fixture-recorder", DeviceId="harakiri-fixture-recorder", Version="0"';

const fixtures = process.argv.slice(2).map((arg) => {
  const split = arg.indexOf("=");
  const [name, term] = [arg.slice(0, split), arg.slice(split + 1)];

  if (split < 1 || term === "") {
    throw new Error(`expected name=searchTerm, got ${arg}`);
  }

  return { name, term };
});

if (fixtures.length === 0) {
  throw new Error("pass at least one fixture as name=searchTerm");
}

const StreamFields = zMediaStream.pick({
  Index: true,
  Type: true,
  Codec: true,
  Profile: true,
  Width: true,
  Height: true,
  BitDepth: true,
  ColorTransfer: true,
  VideoRange: true,
  VideoRangeType: true,
  VideoDoViTitle: true,
  DvProfile: true,
  DvLevel: true,
  DvBlSignalCompatibilityId: true,
  RpuPresentFlag: true,
  ElPresentFlag: true,
  BlPresentFlag: true,
  Hdr10PlusPresentFlag: true,
  AudioSpatialFormat: true,
  Channels: true,
  ChannelLayout: true,
  Language: true,
  IsDefault: true,
  DisplayTitle: true,
});

const SourceFields = zMediaSourceInfo.pick({
  Id: true,
  Container: true,
  DefaultAudioStreamIndex: true,
});

const SignedIn = z.object({ AccessToken: z.string(), User: z.object({ Id: z.string() }) });
const Found = z.object({ Items: z.array(z.object({ Id: z.string() })) });

const Item = z.object({
  Name: z.string(),
  MediaSources: z.array(SourceFields.extend({ MediaStreams: z.array(StreamFields).nullish() })),
});

const call = async <S extends z.ZodType>(
  schema: S,
  endpoint: string,
  init: RequestInit = {},
  token?: string
): Promise<z.infer<S>> => {
  const authorization = token === undefined ? identity : `${identity}, Token="${token}"`;

  const response = await fetch(new URL(endpoint, server), {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: authorization },
  });

  if (!response.ok) {
    throw new Error(`${endpoint}: HTTP ${response.status}`);
  }

  return schema.parse(await response.json());
};

const auth = await call(SignedIn, "/Users/AuthenticateByName", {
  method: "POST",
  body: JSON.stringify({
    Username: process.env.JELLYFIN_DEV_USER ?? "harakiri",
    Pw: process.env.JELLYFIN_DEV_PASSWORD ?? "harakiri-dev",
  }),
});

const token = auth.AccessToken;
const userId = auth.User.Id;

const pick = <T extends object>(record: T, keys: readonly (keyof T)[]): Partial<T> => {
  const picked: Partial<T> = {};

  for (const key of keys) {
    const value = record[key];

    if (value !== null && value !== undefined) {
      picked[key] = value;
    }
  }

  return picked;
};

const recordFixture = async ({ name, term }: { name: string; term: string }): Promise<void> => {
  const search = new URLSearchParams({ searchTerm: term, recursive: "true", limit: "1", userId });
  search.append("includeItemTypes", "Movie");
  search.append("includeItemTypes", "Episode");
  const found = await call(Found, `/Items?${search}`, {}, token);
  const [item] = found.Items;

  if (item === undefined) {
    console.log(`${name}: not in the library yet`);

    return;
  }

  const full = await call(Item, `/Items/${item.Id}?userId=${userId}`, {}, token);
  const [source = {}] = full.MediaSources;

  const streams = (source.MediaStreams ?? []).filter(
    (stream) => stream.Type === "Video" || stream.Type === "Audio"
  );

  const trimmed = {
    ...pick(source, SourceFields.keyof().options),
    MediaStreams: streams.map((stream) => pick(stream, StreamFields.keyof().options)),
  };

  await writeFile(
    path.join(import.meta.dirname, `${name}.json`),
    `${JSON.stringify(scrubSource(trimmed, name), null, 2)}\n`
  );
  console.log(`${name}: ${full.Name} (${streams.length} streams)`);
};

for (const fixture of fixtures) {
  // Sequential on purpose: one fixture at a time against the dev server, so the log stays in order.
  // oxlint-disable-next-line eslint/no-await-in-loop -- sequential recording, ordered log output
  await recordFixture(fixture);
}
