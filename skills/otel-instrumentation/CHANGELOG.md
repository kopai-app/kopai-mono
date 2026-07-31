# kopai/otel-instrumentation

## 2.1.0

### Minor Changes

- #163: Add a Fastify recipe (`references/lang-fastify.md`) built on `@fastify/otel`, registered explicitly through `app.register(fastifyOtel.plugin())` instead of module interception. Covers the Fastify `>=4 <6` support gate, ESM semantics (CommonJS dependencies patch via the require hook; native-ESM dependencies need `--experimental-loader=@opentelemetry/instrumentation/hook.mjs`), why `registerOnInitialization` and manual plugin registration must never be combined, and a scope-based validation assertion (`--scope "@fastify/otel"`) that catches silent plugin-registration failures which HTTP-layer telemetry masks.

  Motivated by dogfooding: the deprecated `@opentelemetry/instrumentation-fastify` was removed from `auto-instrumentations-node` in March 2026, so the generic Node.js recipe produces no Fastify-layer spans — and no error.

- #163: Add a "Picking instrumentation packages" rule to SKILL.md: detect the project's package manager (`packageManager` field, then lockfile) and install with it, check `npm view <pkg> deprecated` against the registry before wiring a package (only npm prints deprecation warnings at install — pnpm truncates them, Yarn 4 prints none), and prefer framework-native plugins over contrib interception. `troubleshoot-missing-spans.md` gains the matching silent-failure causes (native-ESM dependencies, deprecated instrumentation packages), and `lang-nodejs.md` now routes Fastify apps to the new recipe and documents the ESM loader hook.

### Patch Changes

- #163: Correct the `jq` field defaults across the validate/troubleshoot references to the CLI's actual row names (`SpanName`, `TraceId`, `ParentSpanId`, `SpanAttributes`, `Body`, …). The OTLP-style lowercase names read `null`, and the orphan check selected every span as an orphan. Metrics `discover` keeps lowercase names — that output shape differs and was already correct. The "Calibrate once" note in `validate-traces.md` stays as the escape hatch for future shape changes.

## 2.0.0

### Major Changes

- b3f1b16: Rewrite the skill around a self-validating loop (#158). Validation becomes executable rather than "did any data show up": a `validation.run_id` resource attribute tags each run, the agent drives traffic itself including deliberate failures (`drive-traffic.md`), and `validate-traces.md` asserts nine pass/fail checks (orphans, trace depth, route coverage, cardinality, error status and slug, attribute inventory, leftover test spans), with `validate-logs.md`, `validate-metrics.md`, and `validate-shutdown.md` covering correlation, severity, cardinality, and flush on SIGTERM.

  Adds the judgment layer SDK setup never covered: what earns a span, which attributes to attach, error conventions (`error`, span status, `exception.slug`), context propagation and framework accessor traps, sampling, and signal selection. New references: the attribute catalog, per-language custom instrumentation patterns, and trace design for queues, async fan-out, ETL, and serverless. The `rules/` directory is flattened into `references/`.

## 1.1.0

### Minor Changes

- 3894c34: Document the new CLI metrics-aggregation parameters in `cli-reference.md` (#105).

## 1.0.0

### Major Changes

- 79dc63c: Initial version of the skill: OpenTelemetry SDK setup recipes per language, Kopai backend setup, and CLI validation guidance. First published to Tessl in #99–#103.
