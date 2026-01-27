| title                 | impact   | tags                     |
| --------------------- | -------- | ------------------------ |
| Step 4: Check Metrics | CRITICAL | workflow, metrics, step4 |

## Step 4: Check Metrics

**Impact:** CRITICAL

Examine metrics to understand system state during the issue.

### Discover Available Metrics

```bash
npx @kopai/cli metrics discover --json
```

### Check Error Rate Metrics

```bash
npx @kopai/cli metrics search --type Sum --name http_server_errors_total --json
```

### Check Latency Metrics

```bash
npx @kopai/cli metrics search --type Histogram --name http_server_duration --json
```

### Filter by Service

```bash
npx @kopai/cli metrics search --type Gauge --service payment-api --json
```

### Reference

See references/metric-filters.md for all filter options
