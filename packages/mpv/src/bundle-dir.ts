import { bundleDirIn, repoRootFrom } from "./bundle";

process.stdout.write(`${bundleDirIn(repoRootFrom(import.meta.dirname))}\n`);
