| title            | impact | tags                  |
| ---------------- | ------ | --------------------- |
| No Data Received | MEDIUM | troubleshoot, no-data |

## No Data Received

**Impact:** MEDIUM

Troubleshoot when no telemetry data appears in Kopai.

### Checklist

1. **Check Kopai is running**

   ```bash
   curl -X POST http://localhost:4318/v1/traces \
     -H "Content-Type: application/json" \
     -d '{"resourceSpans":[]}'
   ```

2. **Verify endpoint** - Must be `http://localhost:4318` (not 8000)

   ```bash
   echo $OTEL_EXPORTER_OTLP_ENDPOINT
   ```

3. **Check app logs** - Look for OTEL export errors in application output

### Reference

See troubleshoot-wrong-port.md for port confusion issues
