| title              | impact | tags                     |
| ------------------ | ------ | ------------------------ |
| Missing Attributes | MEDIUM | troubleshoot, attributes |

## Missing Attributes

**Impact:** MEDIUM

Troubleshoot when span/resource attributes are missing.

### Checklist

1. **Add custom attributes** - Use SDK's span API

   ```javascript
   // Node.js example
   span.setAttribute("user.id", userId);
   ```

2. **Resource attributes** - Configure at SDK initialization

   ```javascript
   // Node.js example
   new Resource({ "deployment.environment": "production" });
   ```

3. **Search by attribute** - Verify attributes exist
   ```bash
   npx @kopai/cli traces search --span-attr "key=value" --json
   npx @kopai/cli traces search --resource-attr "key=value" --json
   ```

### Reference

https://opentelemetry.io/docs/concepts/semantic-conventions/
