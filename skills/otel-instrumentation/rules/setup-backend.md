| title               | impact   | tags                      |
| ------------------- | -------- | ------------------------- |
| Start Kopai Backend | CRITICAL | setup, backend, collector |

## Start Kopai Backend

**Impact:** CRITICAL

Start Kopai to receive OTEL telemetry data locally.

### Example

```bash
npx @kopai/app start
```

Starts:

- OTEL collector on port 4318 (receives OTLP/HTTP)
- API server on port 8000 (query data)

### Reference

https://github.com/kopai-app/kopai-mono/tree/main/packages/app
