| title                             | impact | tags                         |
| --------------------------------- | ------ | ---------------------------- |
| Pattern: Log-Driven Investigation | HIGH   | pattern, logs, investigation |

## Pattern: Log-Driven Investigation

**Impact:** HIGH

Start investigation from log entries when you don't have a trace ID.

### Workflow

```bash
# 1. Search error logs (severity number >= 17 catches ERROR/FATAL regardless of text casing)
npx @kopai/cli logs search --severity-min 17 --limit 20 --json

# 2. Fallback: search for errors hidden in body/attributes (logged at INFO or no severity)
npx @kopai/cli logs search --body "error" --limit 20 --json

# 3. Extract TraceId from log output
# (look for TraceId field in JSON response)

# 4. Analyze full trace
npx @kopai/cli traces get <traceId> --json
```

### Useful Log Searches

```bash
# By service
npx @kopai/cli logs search --service payment-api --severity-min 17 --json

# By body content
npx @kopai/cli logs search --body "connection refused" --json

# By custom attribute
npx @kopai/cli logs search --log-attr "error.type=timeout" --json
```

### Log Fields

| Field        | Purpose               |
| ------------ | --------------------- |
| TraceId      | Correlate with traces |
| SpanId       | Specific span context |
| SeverityText | Log level             |
| Body         | Log message content   |
