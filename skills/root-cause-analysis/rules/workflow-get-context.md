| title                          | impact   | tags                            |
| ------------------------------ | -------- | ------------------------------- |
| Step 2: Get Full Trace Context | CRITICAL | workflow, trace, context, step2 |

## Step 2: Get Full Trace Context

**Impact:** CRITICAL

Get complete trace details with all spans.

### Get Trace

```bash
npx @kopai/cli traces get <traceId> --json
```

### Analysis Points

| Field          | What to Look For              |
| -------------- | ----------------------------- |
| ParentSpanId   | Span hierarchy/call chain     |
| Duration       | Slow spans (bottlenecks)      |
| SpanAttributes | Request context, parameters   |
| StatusMessage  | Error details, exception info |
| StatusCode     | OK or ERROR                   |

### Select Specific Fields

```bash
npx @kopai/cli traces get <traceId> --fields SpanName,Duration,StatusCode --json
```

### Reference

See references/trace-filters.md for output options
