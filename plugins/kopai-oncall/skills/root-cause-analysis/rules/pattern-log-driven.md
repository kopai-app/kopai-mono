| title                             | impact | tags                         |
| --------------------------------- | ------ | ---------------------------- |
| Pattern: Log-Driven Investigation | HIGH   | pattern, logs, investigation |

## Pattern: Log-Driven Investigation

**Impact:** HIGH

Start from log entries when you don't have a trace ID. Detect errors by
**`SeverityNumber >= 17`** (ERROR/FATAL) — `SeverityText` is free-form and varies by
language (`ERROR`/`error`/`Error`/empty), so never filter on it.

### Workflow (SDK code mode)

```ts
// log-driven.mts — run: npx tsx log-driven.mts
import { kq, KopaiQueryBuildError } from "@kopai/sdk";
import { clientFromConfig } from "@kopai/sdk/node";
const client = clientFromConfig();

try {
  // 1. Rank error volume by service + severity (count errors server-side)
  const volume = kq.logs
    .aggregate()
    .measure((m) => m.count("n"))
    .dimension("SeverityText")
    .dimension("service.name")
    .where((f) => f.gte("SeverityNumber", 17))
    .timeRelative("1h")
    .summary()
    .orderByMeasure("n", "desc")
    .build();
  console.log(JSON.stringify((await client.query(volume)).data, null, 2));

  // 2. Drill into the actual error rows to read messages + grab a TraceId
  const rows = kq.logs
    .raw()
    .where((f) => f.gte("SeverityNumber", 17))
    .timeRelative("1h")
    .limit(20)
    .build();
  const { data: logs } = await client.query(rows);
  console.log(JSON.stringify(logs, null, 2));

  // 3. Bridge to traces: TraceId is the join key from a log to its full trace
  const traceId = logs.find((r) => r.TraceId)?.TraceId;
  if (traceId) {
    const spans = await client.getTrace(traceId);
    console.log(JSON.stringify(spans, null, 2));
  }
} catch (e) {
  if (e instanceof KopaiQueryBuildError) console.error(e.issues);
  else throw e;
}
```

**Fallback when errors hide at INFO/no severity** — some apps log real failures below 17. Search the message body instead: `kq.logs.raw().where(f => f.contains("Body", "error")).timeRelative("1h").limit(20).build()`.

### Useful log searches

```ts
// By service
kq.logs
  .raw()
  .where((f) => f.eq("service.name", "payment-api"))
  .where((f) => f.gte("SeverityNumber", 17))
  .timeRelative("1h")
  .limit(20)
  .build();

// By body content
kq.logs
  .raw()
  .where((f) => f.contains("Body", "connection refused"))
  .timeRelative("1h")
  .limit(20)
  .build();

// By custom attribute (dotted = auto-resolved semconv)
kq.logs
  .raw()
  .where((f) => f.eq("error.type", "timeout"))
  .timeRelative("1h")
  .limit(20)
  .build();
```

### Log Fields

| Field        | Purpose                                                                   |
| ------------ | ------------------------------------------------------------------------- |
| TraceId      | **Bridge to traces** — `client.getTrace(TraceId)` for the full span chain |
| SpanId       | Specific span context within the trace                                    |
| SeverityText | Log level (display only — detect via SeverityNumber >= 17)                |
| Body         | Log message content (`f.contains("Body", "…")`)                           |

**TraceId is the bridge.** Once a log row yields a `TraceId`, hop to the trace
(`client.getTrace`) to get the full span chain, durations, and the call hierarchy
around the failure. No `ServiceName` column — use the dotted `"service.name"` attribute.

### CLI fallback (quick one-offs)

No aggregation in the CLI; use it for a single lookup.

```bash
npx @kopai/cli logs search --severity-min 17 --limit 20 --json
npx @kopai/cli logs search --body "connection refused" --json
npx @kopai/cli logs search --log-attr "error.type=timeout" --json
npx @kopai/cli traces get <traceId> --json
```
