/// <reference types="node" />
// Records trimmed MediaSources from the dev Jellyfin, scrubbed of the library's ids and credits.
// Pass each fixture as name=searchTerm, a term that finds exactly one movie or episode.
// Run from the repo root:
//   mise exec -- bun packages/jellyfin/src/__fixtures__/record.ts dv5-eac3=<search term> ...
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { scrubSource } from "./scrub";

const server = process.env["JELLYFIN_DEV_URL"] ?? "http://127.0.0.1:8096";
const identity =
  'MediaBrowser Client="harakiri-dev", Device="fixture-recorder", DeviceId="harakiri-fixture-recorder", Version="0"';

const fixtures = process.argv.slice(2).map((arg) => {
  const split = arg.indexOf("=");
  const [name, term] = [arg.slice(0, split), arg.slice(split + 1)];
  if (split < 1 || term === "") throw new Error(`expected name=searchTerm, got ${arg}`);
  return { name, term };
});
if (fixtures.length === 0) throw new Error("pass at least one fixture as name=searchTerm");

const STREAM_FIELDS = [
  "Index",
  "Type",
  "Codec",
  "Profile",
  "Width",
  "Height",
  "BitDepth",
  "ColorTransfer",
  "VideoRange",
  "VideoRangeType",
  "VideoDoViTitle",
  "DvProfile",
  "DvLevel",
  "DvBlSignalCompatibilityId",
  "RpuPresentFlag",
  "ElPresentFlag",
  "BlPresentFlag",
  "Hdr10PlusPresentFlag",
  "AudioSpatialFormat",
  "Channels",
  "ChannelLayout",
  "Language",
  "IsDefault",
  "DisplayTitle",
] as const;

type Json = Record<string, unknown>;

const JsonRecord = z.record(z.string(), z.unknown());
const SignedIn = z.object({ AccessToken: z.string(), User: z.object({ Id: z.string() }) });
const Found = z.object({ Items: z.array(z.object({ Id: z.string() })) });
const Item = z.object({
  Name: z.string(),
  MediaSources: z.array(z.looseObject({ MediaStreams: z.array(JsonRecord).nullish() })),
});

const call = async (path: string, init: RequestInit = {}, token?: string): Promise<unknown> => {
  const authorization = token === undefined ? identity : `${identity}, Token="${token}"`;
  const response = await fetch(new URL(path, server), {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: authorization },
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const body: unknown = await response.json();
  return body;
};

const auth = SignedIn.parse(
  await call("/Users/AuthenticateByName", {
    method: "POST",
    body: JSON.stringify({
      Username: process.env["JELLYFIN_DEV_USER"] ?? "harakiri",
      Pw: process.env["JELLYFIN_DEV_PASSWORD"] ?? "harakiri-dev",
    }),
  })
);
const token = auth.AccessToken;
const userId = auth.User.Id;

const pick = (record: Json, keys: readonly string[]): Json =>
  Object.fromEntries(keys.filter((key) => record[key] != null).map((key) => [key, record[key]]));

for (const { name, term } of fixtures) {
  const search = new URLSearchParams({ searchTerm: term, recursive: "true", limit: "1", userId });
  search.append("includeItemTypes", "Movie");
  search.append("includeItemTypes", "Episode");
  const item = Found.parse(await call(`/Items?${search}`, {}, token)).Items[0];
  if (item === undefined) {
    console.log(`${name}: not in the library yet`);
    continue;
  }
  const full = Item.parse(await call(`/Items/${item.Id}?userId=${userId}`, {}, token));
  const source = full.MediaSources[0] ?? {};
  const streams = (source.MediaStreams ?? []).filter(
    (stream) => stream["Type"] === "Video" || stream["Type"] === "Audio"
  );
  const trimmed = {
    ...pick(source, ["Id", "Container", "DefaultAudioStreamIndex"]),
    MediaStreams: streams.map((stream) => pick(stream, STREAM_FIELDS)),
  };
  await writeFile(
    join(import.meta.dirname, `${name}.json`),
    `${JSON.stringify(scrubSource(trimmed, name), null, 2)}\n`
  );
  console.log(`${name}: ${full.Name} (${streams.length} streams)`);
}
