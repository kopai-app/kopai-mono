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

### Protocol: HTTP only

Kopai accepts OTLP over **HTTP only** (port 4318). gRPC (port 4317) is not supported.

Some SDKs default to gRPC — if you see connection errors, check the protocol:

```bash
# Force HTTP protocol (needed for Go, Java, and other SDKs that default to gRPC)
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

| SDK     | Default Protocol | Action Needed                                   |
| ------- | ---------------- | ----------------------------------------------- |
| Node.js | HTTP             | None                                            |
| Python  | HTTP             | None                                            |
| Go      | gRPC             | Set `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` |
| Java    | gRPC             | Set `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` |
| .NET    | HTTP             | None                                            |
| Rust    | HTTP             | None                                            |

### Reference

https://opentelemetry.io/docs/concepts/sdk-configuration/otlp-exporter-configuration/
