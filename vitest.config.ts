import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/packages/otel-testing-harness/examples/jest/**",
      "**/packages/otel-testing-harness/examples/tap/**",
    ],
  },
});
