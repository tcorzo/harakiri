import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type GridKind = "portrait" | "wide" | "hero" | "logo";

export const ARTWORK_SOURCES: Readonly<Record<GridKind, string>> = {
  portrait: "portrait.png",
  wide: "wide.png",
  hero: "hero.png",
  logo: "logo.png",
};

const KINDS: readonly GridKind[] = ["portrait", "wide", "hero", "logo"];

export const gridNames = (appId: number): Readonly<Record<GridKind, string>> => {
  if (!Number.isInteger(appId) || appId < 0 || appId >= 2 ** 32) {
    throw new RangeError(`A Steam app ID is an unsigned 32-bit integer, got ${appId}.`);
  }

  return {
    portrait: `${appId}p.png`,
    wide: `${appId}.png`,
    hero: `${appId}_hero.png`,
    logo: `${appId}_logo.png`,
  };
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

/** mkdir -p `gridDir`, then copies each absent name; returns the names written, in GridKind order. */
export const writeArtwork = async (
  artwork: string,
  gridDir: string,
  appId: number
): Promise<readonly string[]> => {
  const names = gridNames(appId);

  await mkdir(gridDir, { recursive: true });

  const copied = await Promise.all(
    KINDS.map(
      async (kind) =>
        await copyAbsent(path.join(artwork, ARTWORK_SOURCES[kind]), path.join(gridDir, names[kind]))
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
