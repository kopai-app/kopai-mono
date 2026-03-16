import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [
      ...configDefaults.exclude,
      "**/packages/otel-testing-harness/examples/jest/**",
      "**/packages/otel-testing-harness/examples/tap/**",
    ],
  },
});
