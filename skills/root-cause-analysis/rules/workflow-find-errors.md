| title                     | impact   | tags                    |
| ------------------------- | -------- | ----------------------- |
| Step 1: Find Error Traces | CRITICAL | workflow, errors, step1 |

## Step 1: Find Error Traces

**Impact:** CRITICAL

First step in RCA workflow - locate errors across traces and logs.

### 1a. Find Error Traces

```bash
npx @kopai/cli traces search --status-code ERROR --limit 20 --json
```

### 1b. Find Error Logs by Severity Number

Use `--severity-min 17` to catch all error-level logs regardless of text casing.
This is the preferred approach because `SeverityText` is inconsistent across languages/frameworks
(e.g. `ERROR`, `error`, `Error`, or empty), but `SeverityNumber >= 17` always means error-level
per the OTel Log Data Model.

```bash
npx @kopai/cli logs search --severity-min 17 --limit 20 --json
```

| SeverityNumber | Level |
| -------------- | ----- |
| 1-4            | TRACE |
| 5-8            | DEBUG |
| 9-12           | INFO  |
| 13-16          | WARN  |
| 17-20          | ERROR |
| 21-24          | FATAL |

### 1c. Find Hidden Errors (fallback)

Some services log errors at INFO level or with no severity set.
Search log body and attributes as a fallback.

```bash
npx @kopai/cli logs search --body "error" --limit 20 --json
npx @kopai/cli logs search --body "exception" --limit 20 --json
npx @kopai/cli logs search --body "failed" --limit 20 --json
```

### Handling limit saturation

If a search returns exactly `--limit` results, there are likely more errors hidden beyond the limit.
Do NOT stop — continue exploring:

1. **Group by service** to see if one noisy service dominates results
2. **Exclude noisy services** by re-running per-service queries for other services
3. **Increase the limit** or paginate to ensure you're not missing app-level errors
4. **Always run the hidden error searches (1c)** even if 1a/1b return results — real app errors are often logged at INFO severity or only appear in the body text

A single noisy service (e.g. otel collector infrastructure errors) can fill the entire result set and hide critical application errors.

### Filter by Service

```bash
npx @kopai/cli traces search --status-code ERROR --service payment-api --json
npx @kopai/cli logs search --severity-min 17 --service payment-api --json
```

### Filter by Time Range

```bash
# Timestamp in nanoseconds
npx @kopai/cli traces search --status-code ERROR --timestamp-min 1700000000000000000 --json
```

### Reference

See references/trace-filters.md and references/log-filters.md for all filter options
