// What mpv/source.sh reads from a bundle and its recipe, through the same schema and hash as the
// license check and the build:
//   bun packages/mpv/src/source-cli.ts sources <bundle-dir>
//     one line per component's source, tab-separated: "upstream <url> <sha256>" or "srpm <file>"
//   bun packages/mpv/src/source-cli.ts recipe-hash <recipe-dir>
//     the recipe hash of <recipe-dir>, the name of the .cache/mpv/<hash> it builds
import { recipeHash } from "./bundle";
import { bundleComponents } from "./licenses";

const [command, dir] = process.argv.slice(2);

if (dir === undefined) {
  throw new Error("usage: source-cli.ts sources <bundle-dir> | recipe-hash <recipe-dir>");
}

if (command === "sources") {
  const lines = bundleComponents(dir).map(({ source }) =>
    source.kind === "upstream"
      ? `upstream\t${source.url}\t${source.sha256}`
      : `srpm\t${source.srpm}`
  );

  process.stdout.write(`${lines.join("\n")}\n`);
} else if (command === "recipe-hash") {
  process.stdout.write(`${recipeHash(dir)}\n`);
} else {
  throw new Error(`source-cli.ts: unknown command ${command}`);
}
