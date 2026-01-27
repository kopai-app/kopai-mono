| title         | impact | tags                |
| ------------- | ------ | ------------------- |
| Missing Spans | MEDIUM | troubleshoot, spans |

## Missing Spans

**Impact:** MEDIUM

Troubleshoot when expected spans are missing.

### Checklist

1. **SDK initialization** - Ensure SDK is initialized before app code runs

2. **Auto-instrumentation** - Check auto-instrumentation is installed for your frameworks

   ```bash
   # Node.js example
   npm ls @opentelemetry/auto-instrumentations-node
   ```

3. **Service name** - Verify service name is set

   ```bash
   echo $OTEL_SERVICE_NAME
   ```

4. **Search broader** - Try searching without filters first
   ```bash
   npx @kopai/cli traces search --limit 50 --json
   ```

### Reference

Check language-specific setup in lang-\*.md files
