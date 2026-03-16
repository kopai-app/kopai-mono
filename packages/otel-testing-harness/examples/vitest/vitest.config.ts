import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["*.test.ts"],
    globals: true,
    root: path.dirname(fileURLToPath(import.meta.url)),
  },
});
