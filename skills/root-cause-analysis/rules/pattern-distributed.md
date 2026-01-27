| title                         | impact | tags                                |
| ----------------------------- | ------ | ----------------------------------- |
| Pattern: Distributed Failures | HIGH   | pattern, distributed, microservices |

## Pattern: Distributed Failures

**Impact:** HIGH

Diagnose failures across multiple services.

### Workflow

```bash
# 1. Find errors across services
npx @kopai/cli traces search --status-code ERROR --limit 50 --json

# 2. Group by service (use jq)
npx @kopai/cli traces search --status-code ERROR --json | jq 'group_by(.ServiceName) | map({service: .[0].ServiceName, count: length})'

# 3. Trace cross-service flow
npx @kopai/cli traces get <traceId> --fields ServiceName,SpanName,StatusCode --json
```

### Analysis Strategy

1. Identify which service has most errors
2. Check if failures cascade from upstream
3. Look for common root cause (shared dependency)
4. Check resource attributes for infrastructure issues

### Key Fields

| Field        | Purpose                |
| ------------ | ---------------------- |
| ServiceName  | Which service          |
| ParentSpanId | Call chain             |
| SpanKind     | CLIENT/SERVER/INTERNAL |
