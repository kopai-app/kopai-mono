| title                  | impact | tags                          |
| ---------------------- | ------ | ----------------------------- |
| Pattern: Slow Requests | HIGH   | pattern, latency, performance |

## Pattern: Slow Requests

**Impact:** HIGH

Diagnose slow request latency. Lead with the SDK: rank operations by latency, then drill
into the slow span chain. `Duration` is **nanoseconds**.

### 1. Rank operations by latency (SQLite-safe)

`avg`/`max` of `Duration` are portable across backends. Order by `max_ns` to surface the
worst offenders first.

```ts
// slow.mts — run: npx tsx slow.mts
import { kq, KopaiQueryBuildError } from "@kopai/sdk";
import { clientFromConfig } from "@kopai/sdk/node";
const client = clientFromConfig();

try {
  const q = kq.traces
    .aggregate()
    .measure((m) => m.avg("Duration", "avg_ns"))
    .measure((m) => m.max("Duration", "max_ns"))
    .measure((m) => m.count("n"))
    .dimension("SpanName")
    .timeRelative("1h")
    .summary()
    .orderByMeasure("max_ns", "desc")
    .build();

  const { data } = await client.queryTracesAggregate(q);
  console.log(JSON.stringify(data, null, 2));
} catch (e) {
  if (e instanceof KopaiQueryBuildError) console.error(e.issues);
  else throw e;
}
```

> **Watch the avg/max gap.** Long-lived streaming spans (e.g. `EventStream`) inflate `avg`.
> `max` (and percentiles, on ClickHouse) separate a genuinely slow tail from one fat span.

**ClickHouse upgrade — percentiles.** `p95`/`p99` describe the tail far better than `max`,
but they HARD-FAIL on SQLite at query time. Wrap them so the script still runs:

```ts
try {
  const q = kq.traces
    .aggregate()
    .measure((m) => m.avg("Duration", "avg_ns"))
    .measure((m) => m.p95("Duration", "p95_ns"))
    .measure((m) => m.p99("Duration", "p99_ns"))
    .dimension("SpanName")
    .timeRelative("1h")
    .summary()
    .orderByMeasure("p99_ns", "desc")
    .build();
  const { data } = await client.queryTracesAggregate(q);
  console.log(JSON.stringify(data, null, 2));
} catch {
  // SQLite: percentiles unsupported — fall back to the avg/max query above.
}
```

### 2. Drill into the bottleneck

Find the slow traces, then inspect the span breakdown:

```ts
// Slow traces only (> 1s).
const slow = kq.traces
  .raw()
  .where((f) => f.gt("Duration", 1_000_000_000))
  .timeRelative("1h")
  .limit(50)
  .build();

// Bottleneck spans = external CLIENT calls (DB, APIs).
const clientSpans = kq.traces
  .aggregate()
  .measure((m) => m.avg("Duration", "avg_ns"))
  .measure((m) => m.max("Duration", "max_ns"))
  .measure((m) => m.count("n"))
  .dimension("SpanName")
  .where((f) => f.eq("SpanKind", "CLIENT"))
  .timeRelative("1h")
  .summary()
  .orderByMeasure("max_ns", "desc")
  .build();
```

Then `const spans = await client.getTrace(traceId)` and walk `Duration` / `ParentSpanId`
to find which child span dominates.

### Duration Reference

| Duration (ns)    | Human |
| ---------------- | ----- |
| 1000000 (1e6)    | 1ms   |
| 100000000 (1e8)  | 100ms |
| 1000000000 (1e9) | 1s    |
| 5000000000 (5e9) | 5s    |

### Common Bottlenecks

- Database queries (`SpanKind` CLIENT)
- External API calls (`SpanKind` CLIENT)
- Message queue operations
- File I/O operations

### CLI fallback (quick one-offs)

No aggregation in the CLI — use it for a single lookup. Durations are nanosecond strings.

```bash
# Find slow traces (>1s = 1000000000 ns)
npx @kopai/cli traces search --duration-min 1000000000 --json
# Span breakdown for one trace
npx @kopai/cli traces get <traceId> --fields SpanName,Duration,ParentSpanId --json
# External CLIENT calls in a trace
npx @kopai/cli traces search --trace-id <traceId> --span-kind CLIENT --json
```
