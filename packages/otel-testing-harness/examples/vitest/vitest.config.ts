import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["*.test.ts"],
    globals: true,
    root: path.dirname(new URL(import.meta.url).pathname),
  },
});
