| title                   | impact | tags                     |
| ----------------------- | ------ | ------------------------ |
| Node.js Instrumentation | HIGH   | lang, nodejs, javascript |

## Node.js Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for Node.js applications.

### Install

```bash
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http
```

### Example

```javascript
const { NodeSDK } = require("@opentelemetry/sdk-node");
const {
  getNodeAutoInstrumentations,
} = require("@opentelemetry/auto-instrumentations-node");
const {
  OTLPTraceExporter,
} = require("@opentelemetry/exporter-trace-otlp-http");

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

### Reference

https://opentelemetry.io/docs/languages/js/
