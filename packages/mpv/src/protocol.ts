import { z } from "zod";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface CommandRequest {
  readonly command: readonly JsonValue[];
  readonly request_id: number;
}

// mpv omits `data` when a property is unavailable and on most command replies.
const replySchema = z.object({
  request_id: z.number().int(),
  error: z.string(),
  data: z.json().optional(),
});

const propertyChangeSchema = z.object({
  event: z.literal("property-change"),
  id: z.number().int(),
  name: z.string(),
  data: z.json().optional(),
});

const clientMessageSchema = z.object({
  event: z.literal("client-message"),
  args: z.array(z.string()),
});

const otherEventSchema = z.looseObject({ event: z.string() });

export type Reply = z.infer<typeof replySchema>;

export type PropertyChange = z.infer<typeof propertyChangeSchema>;

/** Any mpv event, as received. */
export type MpvEvent = z.infer<typeof otherEventSchema>;

export type InboundMessage =
  | { readonly kind: "reply"; readonly reply: Reply }
  | { readonly kind: "property-change"; readonly change: PropertyChange; readonly event: MpvEvent }
  | { readonly kind: "client-message"; readonly args: readonly string[]; readonly event: MpvEvent }
  | { readonly kind: "event"; readonly event: MpvEvent };

export const parseInboundLine = (line: string): InboundMessage => {
  const json: unknown = JSON.parse(line);
  const event = otherEventSchema.safeParse(json);

  if (!event.success) {
    return { kind: "reply", reply: replySchema.parse(json) };
  }

  switch (event.data.event) {
    case "property-change": {
      return {
        kind: "property-change",
        change: propertyChangeSchema.parse(json),
        event: event.data,
      };
    }

    case "client-message": {
      return {
        kind: "client-message",
        args: clientMessageSchema.parse(json).args,
        event: event.data,
      };
    }

    default: {
      return { kind: "event", event: event.data };
    }
  }
};

export const encodeRequest = (request: CommandRequest): string => `${JSON.stringify(request)}\n`;

/** Splits a chunked byte stream into complete newline-terminated lines. */
export const createLineSplitter = (onLine: (line: string) => void): ((chunk: string) => void) => {
  let buffer = "";

  return (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");

    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);

      if (line.trim() !== "") {
        onLine(line);
      }

      newline = buffer.indexOf("\n");
    }
  };
};
