import { defineProject } from "vitest/config";
import { hermeticExclude } from "../../vitest.shared";

export default defineProject({
  test: {
    name: "mpv",
    environment: "node",
    exclude: hermeticExclude,
  },
});
