| title                  | impact   | tags                               |
| ---------------------- | -------- | ---------------------------------- |
| Step 3: Correlate Logs | CRITICAL | workflow, logs, correlation, step3 |

## Step 3: Correlate Logs with Trace

**Impact:** CRITICAL

Find logs associated with a trace for additional context.

### Get All Logs for Trace

```bash
npx @kopai/cli logs search --trace-id <traceId> --json
```

### Filter by Severity

```bash
npx @kopai/cli logs search --trace-id <traceId> --severity-text ERROR --json
```

### Search Log Body

```bash
npx @kopai/cli logs search --trace-id <traceId> --body "exception" --json
```

### Multiple Filters

```bash
npx @kopai/cli logs search --trace-id <traceId> --severity-text ERROR --body "timeout" --json
```

### Reference

See references/log-filters.md for all filter options
