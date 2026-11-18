import { z } from "zod";

// The server emits Guids without dashes but accepts both forms.
const guid = z
  .string()
  .regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);

export const ItemId = guid.brand<"ItemId">();

export type ItemId = z.output<typeof ItemId>;

export const UserId = guid.brand<"UserId">();

export type UserId = z.output<typeof UserId>;

// Not a Guid for every source type (live TV, multi-version items).
export const MediaSourceId = z.string().min(1).brand<"MediaSourceId">();

export type MediaSourceId = z.output<typeof MediaSourceId>;

export const AccessToken = z.string().min(1).brand<"AccessToken">();

export type AccessToken = z.output<typeof AccessToken>;

export const DeviceId = z.string().min(1).brand<"DeviceId">();

export type DeviceId = z.output<typeof DeviceId>;

// A base URL that relative API paths resolve against: no query or fragment, pathname ending in "/".
export const ServerUrl = z
  .url({ protocol: /^https?$/ })
  .transform((raw) => {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";

    if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;

    return url.href;
  })
  .brand<"ServerUrl">();

export type ServerUrl = z.output<typeof ServerUrl>;
