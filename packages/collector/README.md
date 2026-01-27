# @kopai/collector

OTLP collector as a Fastify plugin. Receives OpenTelemetry traces, metrics, and logs.

## Supported Protocols

| `OTEL_EXPORTER_OTLP_PROTOCOL` | Description          |
| ----------------------------- | -------------------- |
| `http/protobuf`               | OTLP/HTTP + protobuf |
| `http/json`                   | OTLP/HTTP + JSON     |

See [OTLP Exporter Configuration](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/#otel_exporter_otlp_protocol) for details.

## Usage

```typescript
import Fastify from "fastify";
import { collectorPlugin } from "@kopai/collector";

const app = Fastify();

await app.register(collectorPlugin, {
  onTraces: async (data) => {
    // handle traces
  },
  onMetrics: async (data) => {
    // handle metrics
  },
  onLogs: async (data) => {
    // handle logs
  },
});

await app.listen({ port: 4318 });
```

Endpoints:

- `POST /v1/traces`
- `POST /v1/metrics`
- `POST /v1/logs`
