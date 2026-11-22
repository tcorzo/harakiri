import { constants } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

export type GridKind = "portrait" | "wide" | "hero" | "logo";

export const ARTWORK_SOURCES: Readonly<Record<GridKind, string>> = {
  portrait: "portrait.png",
  wide: "wide.png",
  hero: "hero.png",
  logo: "logo.png",
};

const KINDS: readonly GridKind[] = ["portrait", "wide", "hero", "logo"];

/** Each slot's file name without its extension. */
const gridStems = (appId: number): Readonly<Record<GridKind, string>> => {
  if (!Number.isInteger(appId) || appId < 0 || appId >= 2 ** 32) {
    throw new RangeError(`A Steam app ID is an unsigned 32-bit integer, got ${appId}.`);
  }

  return {
    portrait: `${appId}p`,
    wide: `${appId}`,
    hero: `${appId}_hero`,
    logo: `${appId}_logo`,
  };
};

export const gridNames = (appId: number): Readonly<Record<GridKind, string>> => {
  const stems = gridStems(appId);

  return {
    portrait: `${stems.portrait}.png`,
    wide: `${stems.wide}.png`,
    hero: `${stems.hero}.png`,
    logo: `${stems.logo}.png`,
  };
};

/** Steam's "Set custom artwork" can keep the picked file's extension, so any of these fills a slot. */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;

/** The slots that already hold an image under any extension, in any case. */
const filledSlots = async (gridDir: string, stems: Readonly<Record<GridKind, string>>) => {
  const entries = await readdir(gridDir);
  const present = new Set(entries.map((name) => name.toLowerCase()));

  return new Set(
    KINDS.filter((kind) =>
      IMAGE_EXTENSIONS.some((extension) => present.has(`${stems[kind]}.${extension}`))
    )
  );
};

/** Copies one image; false when the destination exists, because that art is the owner's. */
const copyAbsent = async (from: string, to: string): Promise<boolean> => {
  try {
    await copyFile(from, to, constants.COPYFILE_EXCL);

    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return false;
    }

    throw error;
  }
};

/**
 * mkdir -p `gridDir`, then copies each slot that holds no image yet; returns the names written,
 * in GridKind order.
 */
export const writeArtwork = async (
  artwork: string,
  gridDir: string,
  appId: number
): Promise<readonly string[]> => {
  const stems = gridStems(appId);
  const names = gridNames(appId);

  await mkdir(gridDir, { recursive: true });

  const filled = await filledSlots(gridDir, stems);

  const copied = await Promise.all(
    KINDS.map(
      async (kind) =>
        !filled.has(kind) &&
        (await copyAbsent(
          path.join(artwork, ARTWORK_SOURCES[kind]),
          path.join(gridDir, names[kind])
        ))
    )
  );

  return KINDS.flatMap((kind, index) => (copied[index] === true ? [names[kind]] : []));
};

/** Where the PNGs are: `<resourcesPath>/steam` when packaged, else `apps/desktop/build/steam`. */
export const artworkDir = (where: {
  readonly packaged: boolean;
  readonly resourcesPath: string;
  readonly mainDir: string;
}): string =>
  where.packaged
    ? path.join(where.resourcesPath, "steam")
    : path.join(where.mainDir, "../../build/steam");
