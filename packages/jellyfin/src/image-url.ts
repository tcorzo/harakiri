import type { ImageType } from "./generated/types.gen";
import type { ItemId, ServerUrl } from "./ids";

export type ImageSize = {
  /** The rendered width in device pixels; the server scales down to it. */
  readonly maxWidth: number;
  /** The image tag from the item, so a changed image gets a new URL. */
  readonly tag?: string | null;
  readonly quality?: number;
  /** Which backdrop, when an item has several. */
  readonly index?: number;
};

export const imageUrl = (
  server: ServerUrl,
  itemId: ItemId,
  type: ImageType,
  { maxWidth, tag, quality, index }: ImageSize
): string => {
  const path =
    index === undefined
      ? `Items/${itemId}/Images/${type}`
      : `Items/${itemId}/Images/${type}/${index}`;

  const url = new URL(path, server);
  url.searchParams.set("maxWidth", String(Math.round(maxWidth)));

  if (tag != null) url.searchParams.set("tag", tag);

  if (quality !== undefined) url.searchParams.set("quality", String(quality));

  return url.toString();
};
