| title      | impact | tags               |
| ---------- | ------ | ------------------ |
| Wrong Port | MEDIUM | troubleshoot, port |

## Wrong Port

**Impact:** MEDIUM

Troubleshoot port confusion between collector and API.

### Port Reference

| Port | Service        | Purpose                         |
| ---- | -------------- | ------------------------------- |
| 4318 | OTEL Collector | Send telemetry here (OTLP/HTTP) |
| 8000 | API Server     | Query data here (CLI uses this) |

### Common Mistake

```bash
# WRONG - API server doesn't accept OTLP
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:8000

# CORRECT - Collector endpoint
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

### Verify

```bash
# Should return 200 (collector)
curl -I http://localhost:4318/v1/traces

# Should return API response
curl http://localhost:8000/signals/traces
```
