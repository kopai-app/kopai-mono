| title                  | impact | tags                          |
| ---------------------- | ------ | ----------------------------- |
| Pattern: Slow Requests | HIGH   | pattern, latency, performance |

## Pattern: Slow Requests

**Impact:** HIGH

Diagnose slow request latency issues.

### Workflow

```bash
# 1. Find slow traces (>1s = 1000000000 ns)
npx @kopai/cli traces search --duration-min 1000000000 --json

# 2. Analyze span breakdown
npx @kopai/cli traces get <traceId> --fields SpanName,Duration,ParentSpanId --json

# 3. Check for database/external calls
npx @kopai/cli traces search --trace-id <traceId> --span-kind CLIENT --json
```

### Duration Reference

| Duration (ns) | Human |
| ------------- | ----- |
| 1000000       | 1ms   |
| 100000000     | 100ms |
| 1000000000    | 1s    |
| 5000000000    | 5s    |

### Common Bottlenecks

- Database queries (span-kind: CLIENT)
- External API calls (span-kind: CLIENT)
- Message queue operations
- File I/O operations
