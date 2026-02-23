import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["server.ts"],
  format: ["esm"],
  noExternal: [/.*/],
});
