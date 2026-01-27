# Kopai - Agent Guide

Local OpenTelemetry backend for testing instrumentation.

## Quick Start

```bash
# 1. Start backend
npx @kopai/app start

# 2. Configure your app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# 3. Query data
npx @kopai/cli traces search --service my-app --json
```

## Packages

| Package      | Description                            |
| ------------ | -------------------------------------- |
| `@kopai/app` | OTEL collector + API server            |
| `@kopai/cli` | CLI for querying traces, logs, metrics |

## CLI Reference

See [packages/cli/AGENTS.md](packages/cli/AGENTS.md) for full CLI documentation.
