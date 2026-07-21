| title                         | impact | tags                                |
| ----------------------------- | ------ | ----------------------------------- |
| Pattern: Distributed Failures | HIGH   | pattern, distributed, microservices |

## Pattern: Distributed Failures

**Impact:** HIGH

Diagnose failures cascading across multiple services. Lead with an aggregate to find
the failing hop, then drill into one trace's call chain.

### Code mode (recommended)

**1. Find the failing hop** — rank services by error rate. `errorRate` counts `Error`
spans server-side, so you never have to filter on `StatusCode` yourself:

```ts
// rca-distributed.mts — run: npx tsx rca-distributed.mts
import { kq, KopaiQueryBuildError } from "@kopai/sdk";
import { clientFromConfig } from "@kopai/sdk/node";
const client = clientFromConfig();

try {
  const q = kq.traces
    .aggregate()
    .measure((m) => m.errorRate("error_rate"))
    .measure((m) => m.throughput("rps"))
    .measure((m) => m.count("n"))
    .dimension("service.name")
    .timeRelative("1h")
    .summary()
    .orderByMeasure("error_rate", "desc")
    .build();
  const { data } = await client.query(q);
  console.log(JSON.stringify(data, null, 2));
} catch (e) {
  if (e instanceof KopaiQueryBuildError) console.error(e.issues);
  else throw e;
}
```

**2. See the cascade order** — swap `.summary()` for `.timeSeries("5m")` to find which
service started failing first (upstream onset precedes downstream):

```ts
const q = kq.traces
  .aggregate()
  .measure((m) => m.errorRate("error_rate"))
  .dimension("service.name")
  .timeRelative("3h")
  .timeSeries("5m")
  .orderByMeasure("error_rate", "desc")
  .build();
```

**3. Trace the call chain** — pick a failing `TraceId` from a span query, then pull the
full trace and walk `ParentSpanId` / `SpanKind` to see where the failure originates.
`SpanKind === "Client"` spans are the cross-service / external calls:

```ts
const spans = await client.getTrace(traceId);
// ParentSpanId empty == root span. Follow ParentSpanId up the chain;
// the earliest Error span (SpanKind Client calling a failing Server) is the failing hop.
const chain = spans.map((s) => ({
  span: s.SpanName,
  kind: s.SpanKind,
  parent: s.ParentSpanId,
  status: s.StatusCode,
  msg: s.StatusMessage,
}));
console.log(JSON.stringify(chain, null, 2));
```

### Analysis Strategy

1. **Which service has most errors** — order the step-1 aggregate by `error_rate` desc.
2. **Do failures cascade from upstream** — use the step-2 `timeSeries("5m")`; the
   service whose error rate climbs first is upstream of the rest.
3. **Common root cause / shared dependency** — if many services spike together, look for
   a shared `Client` target (DB, external API). Add `.dimension("SpanKind")` or filter
   `f.eq("SpanKind", "Client")` to isolate dependency calls.
4. **Infra issues** — group on resource attributes (`k8s.pod.name`, `k8s.namespace.name`,
   `host.name`, `cloud.region`) to spot a single bad node/region.

### Key Fields

| Field          | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `service.name` | Which service (dotted attr → `ResourceAttributes`)            |
| `ParentSpanId` | Call chain — empty on root; follow up to find the failing hop |
| `SpanKind`     | `Client` (outbound dep call) / `Server` / `Internal`          |

### CLI fallback (quick one-offs)

No aggregation in the CLI; use it for a single lookup. Status value is the literal
`Error` (not `ERROR`):

```bash
npx @kopai/cli traces search --status-code Error --limit 50 --json
npx @kopai/cli traces get <traceId> --fields SpanName,SpanKind,StatusCode --json
```
