| title                          | impact   | tags                            |
| ------------------------------ | -------- | ------------------------------- |
| Step 2: Get Full Trace Context | CRITICAL | workflow, trace, context, step2 |

## Step 2: Get Full Trace Context

**Impact:** CRITICAL

Pull every span of a trace, then inspect fields per row. `getTrace` returns
`OtelTracesRow[]` — no time window or query builder needed.

### Get the trace (code mode)

```ts
// get-context.mts — run: npx tsx get-context.mts
import { clientFromConfig } from "@kopai/sdk/node";
const client = clientFromConfig();

const traceId = "<traceId>";
const spans = await client.getTrace(traceId); // OtelTracesRow[] — all spans

// Slowest span = likely bottleneck (Duration is NANOSECONDS: 1ms=1e6, 1s=1e9).
const slowest = [...spans].sort(
  (a, b) => Number(b.Duration) - Number(a.Duration)
)[0];

// Earliest Error in the chain = usually closest to root cause.
const firstError = [...spans]
  .filter((s) => s.StatusCode === "Error") // "Unset" | "Ok" | "Error"
  .sort((a, b) => Number(a.Timestamp) - Number(b.Timestamp))[0];

console.log(JSON.stringify({ slowest, firstError }, null, 2));
```

"Select specific fields" is just reading row props — no `--fields` flag. Project
what you need:

```ts
const view = spans.map((s) => ({
  SpanName: s.SpanName,
  Duration: s.Duration, // nanoseconds
  StatusCode: s.StatusCode, // "Unset" | "Ok" | "Error"
  ParentSpanId: s.ParentSpanId,
}));
console.log(JSON.stringify(view, null, 2));
```

### Analysis Points

| Field          | What to Look For                                            |
| -------------- | ----------------------------------------------------------- |
| ParentSpanId   | Span hierarchy / call chain (empty on root span)            |
| Duration       | Slow spans (bottlenecks) — **nanoseconds**, find the max    |
| SpanAttributes | Request context, parameters                                 |
| StatusMessage  | Error details, exception info                               |
| StatusCode     | `"Ok"` / `"Error"` (successful spans are usually `"Unset"`) |

Two questions drive the read: **which span is slowest** (max `Duration`) and
**where the chain first broke** (earliest span with `StatusCode === "Error"`,
ordered by `Timestamp`). Reconstruct hierarchy from `ParentSpanId` to see which
call dragged the latency or threw first.

### CLI fallback (one-off lookup)

```bash
npx @kopai/cli traces get <traceId> --json
npx @kopai/cli traces get <traceId> --fields SpanName,Duration,StatusCode --json
```

### Reference

See references/trace-filters.md for trace columns and field details.
