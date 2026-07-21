import { defineConfig } from "tsdown";

export default defineConfig({
  // `index` is platform-neutral (browser-safe). `node` is a Node-only subpath
  // (`@kopai/sdk/node`) for `.kopairc` reading; its `node:*` imports stay
  // external so the neutral build never tries to bundle them.
  entry: ["src/index.ts", "src/node.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  platform: "neutral", // Universal runtime support (no Node-specific deps)
  // The `node` entry imports `node:*` builtins; keep them external so the
  // neutral build leaves them as runtime imports instead of trying to bundle.
  deps: { neverBundle: [/^node:/] },
});
