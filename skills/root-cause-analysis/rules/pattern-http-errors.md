| title                    | impact | tags                       |
| ------------------------ | ------ | -------------------------- |
| Pattern: HTTP 500 Errors | HIGH   | pattern, http, 500, errors |

## Pattern: HTTP 500 Errors

**Impact:** HIGH

Diagnose HTTP 500 internal server errors.

### Workflow

```bash
# 1. Find failed HTTP spans
npx @kopai/cli traces search --status-code ERROR --span-attr "http.status_code=500" --json

# 2. Get trace details
npx @kopai/cli traces get <traceId> --json

# 3. Check error logs
npx @kopai/cli logs search --trace-id <traceId> --severity-text ERROR --json
```

### Key Attributes to Check

| Attribute        | Purpose              |
| ---------------- | -------------------- |
| http.status_code | HTTP response code   |
| http.route       | Endpoint that failed |
| error.message    | Error description    |
| exception.type   | Exception class      |

### Reference

https://opentelemetry.io/docs/specs/semconv/http/
