| title                   | impact | tags                                       |
| ----------------------- | ------ | ------------------------------------------ |
| Fastify Instrumentation | HIGH   | lang, nodejs, fastify, traces, esm, plugin |

# Fastify Instrumentation

Instrument Fastify with **`@fastify/otel`** — the plugin maintained by the Fastify
team — registered explicitly through `app.register(...)`, plus the Node SDK for
everything below the framework (HTTP server, DB clients, fetch).

## The one rule

Never install `@opentelemetry/instrumentation-fastify`. It was deprecated in January
2025 in favor of `@fastify/otel` and removed from `auto-instrumentations-node` in
March 2026. It relies on module interception, which is where silent failures live: a
dependency loaded through a path the hooks don't cover — native ESM being the common
case — leaves the SDK loaded, printing no error, instrumenting nothing.
`@fastify/otel` hooks routes through Fastify's own plugin system, so loader semantics
never enter the picture.

If the codebase already depends on `@opentelemetry/instrumentation-fastify`, migrate to
this recipe — do not work around it. Two gates: `@fastify/otel` supports Fastify
`>=4 <6` (a Fastify 3 app must upgrade the framework first; the contrib package was the
only option there and is unmaintained), and the OTel packages below require Node.js
`^18.19.0 || >=20.6.0` — the same floor `node --import` needs.

## Install

```bash
npm install @fastify/otel @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
```

npm shown — install with the project's own package manager (`pnpm add` / `yarn add`),
detected per the package-picking rule in SKILL.md.

`@fastify/otel` handles the framework layer and stands alone if it must: it extracts
incoming trace context itself and emits a SERVER-kind `request` span when no HTTP
instrumentation is active. Keep `@opentelemetry/instrumentation-http` (bundled in the
auto-instrumentations) anyway — it adds the protocol-level server span (the Fastify
span then nests under it as INTERNAL), propagation on outgoing requests to downstream
services, and the rest of the auto-instrumentation coverage.

## Instrumentation file (instrumentation.mjs)

Create the Fastify instrumentation here and **export it** so the app can register its
plugin:

```javascript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import FastifyOtelInstrumentation from "@fastify/otel";

export const fastifyOtel = new FastifyOtelInstrumentation();

const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations(), fastifyOtel],
});

sdk.start();

// Graceful shutdown
process.on("SIGTERM", () => {
  sdk
    .shutdown()
    .then(() => console.log("Tracing terminated"))
    .catch((error) => console.log("Error terminating tracing", error))
    .finally(() => process.exit(0));
});
```

## Register the plugin (server.mjs)

`await` the registration, and do it **before any route or hook definition** — the
plugin has to see every route being registered:

```javascript
import Fastify from "fastify";
import { fastifyOtel } from "./instrumentation.mjs";

const app = Fastify();

await app.register(fastifyOtel.plugin()); // first registration, always awaited

app.get("/", async () => ({ hello: "world" }));

// Skip telemetry for noise routes
app.get("/healthcheck", { config: { otel: false } }, async () => "Up!");

await app.listen({ port: 3000 });
```

## Run

```bash
node --import ./instrumentation.mjs server.mjs
```

`server.mjs` already imports the instrumentation file, but keep `--import` anyway: it
guarantees the SDK starts before anything else `server.mjs` pulls in.

Know what patches without further help in a `"type": "module"` app: CommonJS
dependencies — Fastify itself and most database drivers — still load through the
`require` hook and patch fine. Dependencies published as **native ESM** bypass that
hook. If the validate step shows their client spans missing, add OTel's ESM loader
hook:

```bash
node --experimental-loader=@opentelemetry/instrumentation/hook.mjs \
  --import ./instrumentation.mjs server.mjs
```

The hook is experimental and wraps every import — add it when validation shows the gap,
not by default. The Fastify layer needs none of this; the plugin registers through
Fastify itself.

## registerOnInitialization — one mode, never both

`new FastifyOtelInstrumentation({ registerOnInitialization: true })` auto-registers the
plugin on every Fastify instance created after `sdk.start()`. No module interception is
involved — `@fastify/otel` does none at all — it subscribes to Fastify's
`fastify.initialization` diagnostics channel. A valid alternative, with two conditions
this recipe prefers not to depend on: the SDK must be enabled before any Fastify
instance exists, and the running Fastify version must publish that channel. Explicit
`app.register(fastifyOtel.plugin())` costs one line, is visible in app code, and cannot
miss.

Pick exactly one mode. With the flag on, also registering the plugin manually decorates
the same instance twice and Fastify throws (decoration already present).

## What gets instrumented

| Layer                     | Package                               | Spans                                                |
| ------------------------- | ------------------------------------- | ---------------------------------------------------- |
| HTTP server               | `@opentelemetry/instrumentation-http` | Root span per request, incoming context extraction   |
| Fastify framework         | `@fastify/otel`                       | Request/handler spans, hook spans, sets `http.route` |
| Downstream (db, fetch, …) | auto-instrumentations-node            | Client spans as children of the handler              |

## Validate

The generic loop applies unchanged, but add one Fastify-specific assertion: spans from
the `@fastify/otel` instrumentation scope exist. HTTP-layer-only telemetry is exactly
what a failed plugin registration produces, and it looks healthy until you group by
scope:

```bash
npx @kopai/cli traces search --scope "@fastify/otel" \
  --resource-attr "validation.run_id=$RUN_ID" --json | jq 'length'
```

**Pass:** greater than zero — the plugin's `request` and handler spans are flowing,
with `http.route` in `SpanAttributes`.
**Fail:** zero while generic HTTP spans exist = the plugin never registered. Check that
`app.register(fastifyOtel.plugin())` runs before any route definition and is awaited.

## Reference

- [@fastify/otel](https://github.com/fastify/otel)

## Next

SDK setup is step 3 of six. It gets bytes flowing; it does not make the telemetry good.

1. Decide what earns a span — `instrument-spans.md`
2. Add the context that makes spans answerable — `instrument-attributes.md`
3. Instrument the error paths — `instrument-errors.md`
4. Drive traffic yourself — `drive-traffic.md`
5. Assert on what arrived — `validate-traces.md`

Confirm before moving on: the SDK starts **before** any application code that could
create a span, and shutdown flushes on SIGTERM (`validate-shutdown.md`). Both fail
silently.
