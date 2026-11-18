import { defineConfig } from "vitest/config";

import { hermeticExclude } from "../../vitest.shared";

export default defineConfig({
  test: {
    name: "jellyfin",
    environment: "node",
    exclude: hermeticExclude,
  },
});
