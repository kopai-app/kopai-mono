| title                     | impact   | tags                    |
| ------------------------- | -------- | ----------------------- |
| Step 1: Find Error Traces | CRITICAL | workflow, errors, step1 |

## Step 1: Find Error Traces

**Impact:** CRITICAL

First step in RCA workflow - locate error traces.

### Find Recent Errors

```bash
npx @kopai/cli traces search --status-code ERROR --limit 20 --json
```

### Filter by Service

```bash
npx @kopai/cli traces search --status-code ERROR --service payment-api --json
```

### Filter by Time Range

```bash
# Timestamp in nanoseconds
npx @kopai/cli traces search --status-code ERROR --timestamp-min 1700000000000000000 --json
```

### Reference

See references/trace-filters.md for all filter options
