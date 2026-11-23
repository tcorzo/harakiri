// Prints the RPM capability of each host lib the current recipe's build needs, one per line
// (`libasound.so.2()(64bit)`), for `mise run package:check-image` to install.
import path from "node:path";

import { bundleDirIn, repoRootFrom } from "./bundle";
import { hostNeeds, readHostLibs } from "./host-libs";

const root = repoRootFrom(import.meta.dirname);

for (const soname of hostNeeds(bundleDirIn(root), readHostLibs(path.join(root, "mpv")))) {
  process.stdout.write(`${soname}()(64bit)\n`);
}
