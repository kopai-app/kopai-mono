---
name: otel-instrumentation
description: Instrument applications with OpenTelemetry SDK and validate telemetry using Kopai. Use when setting up observability, adding tracing/logging/metrics, testing instrumentation, debugging missing telemetry data, or when traces/logs/metrics aren't appearing after setup. Also use when users say things like "my traces aren't showing up", "I don't see any data", or "how do I add observability to my app".
license: Apache-2.0
metadata:
  author: kopai
  version: "1.1.0"
---

# OpenTelemetry Instrumentation with Kopai

Guide for instrumenting applications with OpenTelemetry SDK and validating telemetry locally using Kopai.

## Quick Reference

```bash
# Start backend
npx @kopai/app start

# Configure app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=my-service

# Validate telemetry
npx @kopai/cli traces search --service my-service --json
npx @kopai/cli logs search --service my-service --json
npx @kopai/cli metrics discover --json
```

## Workflow

1. **Start backend** — `npx @kopai/app start`
2. **Set env vars** — `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` and `OTEL_SERVICE_NAME=<name>`
3. **Instrument app** — install SDK + auto-instrumentation for your language (see rules below)
4. **Validate** — `npx @kopai/cli traces search --service <name> --json`. If empty: check endpoint/port, verify app is running and generating traffic, wait 10-30s and retry
5. **Troubleshoot** — if still no data, check rules in section 4 below

## Quick Example (Node.js)

```bash
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/api
```

Create `instrumentation.mjs`:

```javascript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
const sdk = new NodeSDK({ instrumentations: [getNodeAutoInstrumentations()] });
sdk.start();
```

Run: `node --import ./instrumentation.mjs server.mjs`

## Rules

### 1. Setup (CRITICAL)

- `setup-backend` - Start Kopai Backend
- `setup-environment` - Configure Environment

### 2. Language SDKs (HIGH)

- `lang-nodejs` - Node.js Instrumentation
- `lang-nextjs` - Next.js Instrumentation
- `lang-python` - Python Instrumentation
- `lang-go` - Go Instrumentation
- `lang-java` - Java Instrumentation
- `lang-dotnet` - .NET Instrumentation
- `lang-ruby` - Ruby Instrumentation
- `lang-php` - PHP Instrumentation
- `lang-rust` - Rust Instrumentation
- `lang-erlang` - Erlang/Elixir Instrumentation
- `lang-cpp` - C++ Instrumentation

### 3. Validation (HIGH)

- `validate-traces` - Validate Traces
- `validate-logs` - Validate Logs
- `validate-metrics` - Validate Metrics

### 4. Troubleshooting (MEDIUM)

- `troubleshoot-no-data` - No Data Received
- `troubleshoot-missing-spans` - Missing Spans
- `troubleshoot-missing-attrs` - Missing Attributes
- `troubleshoot-wrong-port` - Wrong Port

Read `rules/<rule-name>.md` for details.

## References

- [cli-reference](references/cli-reference.md) - Kopai CLI command reference
- [otel-docs](references/otel-docs.md) - OpenTelemetry documentation links
- [nextjs-examples](references/nextjs-examples.md) - Next.js instrumentation examples
