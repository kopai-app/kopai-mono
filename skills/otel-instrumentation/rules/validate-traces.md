| title           | impact | tags             |
| --------------- | ------ | ---------------- |
| Validate Traces | HIGH   | validate, traces |

## Validate Traces

**Impact:** HIGH

Verify traces are being collected by Kopai.

### List Recent Traces

```bash
npx @kopai/cli traces search --service my-service --limit 10 --json
```

### Get Specific Trace

```bash
npx @kopai/cli traces get <traceId> --json
```

### Search by Span Name

```bash
npx @kopai/cli traces search --span-name "GET /api/users" --json
```

### Search by Attributes

```bash
npx @kopai/cli traces search --span-attr "http.method=GET" --json
npx @kopai/cli traces search --resource-attr "k8s.pod.name=web-1" --json
```

### Reference

https://github.com/kopai-app/kopai-mono/tree/main/packages/cli
