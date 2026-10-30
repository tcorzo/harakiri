import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./openapi/jellyfin-openapi-12.4.0.json",
  output: "./src/generated",
  plugins: [
    "@hey-api/client-ky",
    "@hey-api/typescript",
    "zod",
    "@hey-api/sdk",
    "@tanstack/react-query",
  ],
});
