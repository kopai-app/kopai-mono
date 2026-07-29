| title               | impact   | tags                      |
| ------------------- | -------- | ------------------------- |
| Start Kopai Backend | CRITICAL | setup, backend, collector |

# Start Kopai Backend

```bash
npx @kopai/app start
```

Starts two things, on two ports that are easy to confuse:

| Port | Service        | Direction                                     |
| ---- | -------------- | --------------------------------------------- |
| 4318 | OTEL collector | Your app **sends** telemetry here (OTLP/HTTP) |
| 8000 | API server     | The CLI and SDK **read** data from here       |

Pointing `OTEL_EXPORTER_OTLP_ENDPOINT` at 8000 is the most common setup mistake —
see `troubleshoot-wrong-port.md`.

## Confirm it is up

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4318/v1/traces \
  -H 'Content-Type: application/json' -d '{"resourceSpans":[]}'
```

A 2xx means the collector is accepting OTLP. This is step 1 of the workflow, and every
later assertion depends on it — do not proceed past a non-2xx here.

## Reference

https://github.com/kopai-app/kopai-mono/tree/main/packages/app
