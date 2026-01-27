| title                 | impact   | tags               |
| --------------------- | -------- | ------------------ |
| Configure Environment | CRITICAL | setup, env, config |

## Configure Environment

**Impact:** CRITICAL

Set environment variables for OTEL SDK to export telemetry to Kopai.

### Example

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=my-service
```

### Required Variables

| Variable                    | Value                 | Description                     |
| --------------------------- | --------------------- | ------------------------------- |
| OTEL_EXPORTER_OTLP_ENDPOINT | http://localhost:4318 | Kopai collector endpoint        |
| OTEL_SERVICE_NAME           | your-service          | Identifies service in telemetry |

### Reference

https://opentelemetry.io/docs/concepts/sdk-configuration/otlp-exporter-configuration/
