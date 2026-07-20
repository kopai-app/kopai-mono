| title         | impact | tags           |
| ------------- | ------ | -------------- |
| Validate Logs | HIGH   | validate, logs |

## Validate Logs

**Impact:** HIGH

Verify logs are being collected by Kopai.

### Search by Service

```bash
npx @kopai/cli logs search --service my-service --json
```

### Correlate with Trace

```bash
npx @kopai/cli logs search --trace-id <traceId> --json
```

### Filter by Severity

```bash
npx @kopai/cli logs search --severity-text ERROR --json
```

### Search Log Body

```bash
npx @kopai/cli logs search --body "connection refused" --json
```

### Next: design the records

Logs flowing but narrative one-liners? The pipeline is done — the records are
not. Implement wide events (one context-rich record per unit of work,
correlated to its span) with the `wide-events` skill.

### Reference

https://github.com/kopai-app/kopai-mono/tree/main/packages/cli
