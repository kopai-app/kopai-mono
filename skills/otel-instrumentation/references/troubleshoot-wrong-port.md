| title      | impact | tags               |
| ---------- | ------ | ------------------ |
| Wrong Port | MEDIUM | troubleshoot, port |

# Wrong Port

Kopai runs two servers, and sending telemetry to the wrong one produces silence rather
than an error.

| Port | Service        | Direction                                     |
| ---- | -------------- | --------------------------------------------- |
| 4318 | OTEL collector | Your app **sends** telemetry here (OTLP/HTTP) |
| 8000 | API server     | The CLI and SDK **read** data from here       |

```bash
# WRONG — the API server does not accept OTLP
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:8000

# CORRECT
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Port 4317 is also wrong: that is the conventional gRPC port, and Kopai is HTTP-only.
A Go or Java SDK left on its default will try it — `setup-environment.md` covers forcing
`OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`.

## Verify both ends

```bash
# collector accepts OTLP
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4318/v1/traces \
  -H 'Content-Type: application/json' -d '{"resourceSpans":[]}'

# API server answers queries
curl -s http://localhost:8000/signals/traces | head -c 200
```

Check the endpoint in the shell that **launched the app**. A correction exported
afterwards never reaches the running process — restart it.
