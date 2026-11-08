import { defineConfig } from "tsdown";
import { inlineWorkerPlugin } from "./build/inline-worker-plugin.ts";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  external: ["zod"],
  // `?worker&inline` imports become a Blob-URL constructor over a bundled
  // IIFE string (Service Map worker, see build/inline-worker-plugin.ts).
  plugins: [inlineWorkerPlugin()],
});
