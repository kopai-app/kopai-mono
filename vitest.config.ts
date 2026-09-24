import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Vitest's 5s default is tuned for unit tests. These suites run real
    // Fastify servers, real SQLite, ClickHouse containers, AJV compiles of a
    // 28KB schema document and a 4,000-input fuzz, and a shared CI runner is
    // roughly 25x slower at that work than a developer machine: one test
    // measured 136 ms locally and 3,510 ms on a 2-vCPU runner. Run-to-run
    // variance there is wide too — the same file measured 2,816 ms and 4,666 ms
    // in consecutive runs — so a healthy test sitting at half the budget fails
    // on the unlucky run and passes on a re-run, which is the worst kind of red.
    //
    // 15s leaves every test measured on CI at least 3x its worst observed time,
    // while still failing a genuinely stuck one well inside a 75-second job. It
    // is not cover for slow tests: vitest prints the duration of anything over
    // 300 ms, so cost that creeps stays visible in the log.
    testTimeout: 15_000,
    exclude: [
      ...configDefaults.exclude,
      "**/packages/otel-testing-harness/examples/jest/**",
      "**/packages/otel-testing-harness/examples/tap/**",
    ],
  },
});
