# @kopai/otel-testing-harness

[![npm](https://img.shields.io/npm/v/@kopai/otel-testing-harness?label=latest)](https://www.npmjs.com/package/@kopai/otel-testing-harness)

In-process OTLP collector for testing OpenTelemetry instrumentation. Spins up a real HTTP server backed by in-memory SQLite so you can send telemetry via the OTel SDK and assert on it directly in your tests.

## Usage

```typescript
import { createOtelTestingHarness } from "@kopai/otel-testing-harness";
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";

const harness = await createOtelTestingHarness({ port: 0 });

const tracerProvider = new BasicTracerProvider({
  resource: resourceFromAttributes({ "service.name": "my-service" }),
  spanProcessors: [
    new SimpleSpanProcessor(
      new OTLPTraceExporter({
        url: `http://127.0.0.1:${harness.port}/v1/traces`,
      })
    ),
  ],
});
trace.setGlobalTracerProvider(tracerProvider);

const span = trace.getTracer("test").startSpan("my-span");
span.end();
await tracerProvider.forceFlush();

const { data } = await harness.getTraces({});
expect(data[0].SpanName).toBe("my-span");

await tracerProvider.shutdown();
trace.disable();
await harness.stop();
```

## API

`createOtelTestingHarness(opts?)` returns a `Promise<OtelTestingHarness>` with:

| Member               | Description                                           |
| -------------------- | ----------------------------------------------------- |
| `port`               | Actual port the server is listening on                |
| `getTraces(filter?)` | Query stored traces                                   |
| `getLogs(filter?)`   | Query stored logs                                     |
| `getMetrics(filter)` | Query stored metrics (`metricType` required)          |
| `discoverMetrics()`  | List all collected metric names and types             |
| `clear()`            | Delete all telemetry data                             |
| `stop()`             | Shut down the server and close the database           |
| `datasource`         | Direct access to the underlying `TelemetryDatasource` |

## Options

| Option | Default       | Description                                             |
| ------ | ------------- | ------------------------------------------------------- |
| `port` | `4318`        | Port to listen on. Use `0` for a random available port. |
| `host` | `"localhost"` | Host to bind to.                                        |

## Cross-Runner Support

Works with any Node.js test runner. See [`examples/`](./examples) for complete working tests using:

- [vitest](./examples/vitest)
- [jest](./examples/jest)
- [node-tap](./examples/tap)
- [node:test](./examples/node-test)
