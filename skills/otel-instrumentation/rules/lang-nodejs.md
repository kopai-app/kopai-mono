| title                   | impact | tags                                            |
| ----------------------- | ------ | ----------------------------------------------- |
| Node.js Instrumentation | HIGH   | lang, nodejs, javascript, traces, logs, metrics |

## Node.js Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for Node.js applications with automatic instrumentation.

### Install

```bash
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/api
```

### Configuration

**Environment Variables:**
| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (e.g., `http://localhost:4318`) |
| `OTEL_SERVICE_NAME` | Service name shown in observability backend |

### Instrumentation File (instrumentation.mjs)

Create a separate instrumentation file that loads before your application:

```javascript
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

### Run with Instrumentation

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

### What Gets Instrumented

The auto-instrumentation automatically captures:

- **Traces**: HTTP requests, Express routes, database queries
- **Logs**: Console output (with additional config)
- **Metrics**: HTTP request metrics (with additional config)

The SDK auto-detects `OTEL_EXPORTER_OTLP_ENDPOINT` and exports via OTLP HTTP.

### Example

See the complete working example: [kopai-integration-examples/node-js](https://github.com/kopai-app/kopai-integration-examples/tree/main/node-js)

### Reference

[OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/)
