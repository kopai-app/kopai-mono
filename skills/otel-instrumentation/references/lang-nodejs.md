| title                   | impact | tags                                            |
| ----------------------- | ------ | ----------------------------------------------- |
| Node.js Instrumentation | HIGH   | lang, nodejs, javascript, traces, logs, metrics |

# Node.js Instrumentation

Set up OpenTelemetry SDK for Node.js applications with automatic instrumentation.

## Install

```bash
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/api
```

npm shown — install with the project's own package manager (`pnpm add` / `yarn add`),
detected per the package-picking rule in SKILL.md.

## Configuration

**Environment Variables:**

| Variable                      | Description                                   |
| ----------------------------- | --------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (e.g., `http://localhost:4318`) |
| `OTEL_SERVICE_NAME`           | Service name shown in observability backend   |

## Instrumentation File (instrumentation.mjs)

Create a separate instrumentation file that loads before your application:

```javascript
// Only in a "type": "module" app: route ES-module imports through OTel's loader hook
// so `import http from "node:http"` and native-ESM dependencies get patched too.
import { register } from "node:module";
register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
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

## Run with Instrumentation

```bash
# Load instrumentation before your app
node --import ./instrumentation.mjs server.mjs
```

Or in package.json:

```json
{
  "type": "module",
  "scripts": {
    "start": "node --import ./instrumentation.mjs server.mjs"
  }
}
```

The instrumentations patch modules as they are loaded through Node's `require` hook.
In a `"type": "module"` app, only CommonJS dependencies still come through that hook.
Everything the app itself imports with `import` — `node:http`, `node:https`, and any
dependency published as native ESM — bypasses it, so an ESM app with the plain file
above starts, exports its runtime metrics, and never produces a single span. The two
`register(...)` lines at the top of the file fix that without extra flags; the
equivalent flag is `--experimental-loader=@opentelemetry/instrumentation/hook.mjs`,
which prints an experimental warning on every start. CommonJS apps (`require`) need
neither.

Check for it in the validation step: a service that shows metrics but no spans has
almost always skipped the hook.

## What Gets Instrumented

The auto-instrumentation automatically captures:

- **Traces**: HTTP requests, Express routes, database queries
- **Logs**: Console output (with additional config)
- **Metrics**: HTTP request metrics (with additional config)

The SDK auto-detects `OTEL_EXPORTER_OTLP_ENDPOINT` and exports via OTLP HTTP.

## Framework coverage

`getNodeAutoInstrumentations()` covers Express, Koa, Hapi, and most HTTP/DB clients. It
does **not** cover Fastify — that instrumentation moved to the Fastify team
(`@fastify/otel`) and the deprecated contrib package was removed from the bundle in
March 2026. Fastify app → `lang-fastify.md`, which registers a plugin instead of
relying on module interception.

## Example

See the complete working example: [kopai-integration-examples/node-js](https://github.com/kopai-app/kopai-integration-examples/tree/main/node-js)

## Reference

[OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/)

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
