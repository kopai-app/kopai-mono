# Trace query reference

Columns, filters, and measures for `kq.traces.aggregate()` / `kq.traces.raw()` (and the
`client.searchTraces(...)` filter shape). Build with `kq`, run with `client.query(q)` —
fully typed: aggregate → `{ data }`, raw → `{ data, nextCursor }`.

> Gotcha: enum columns (`StatusCode`, `SpanKind`) and column names are type-checked — a
> wrong value (e.g. `StatusCode: "ERROR"` instead of `"Error"`) or the non-column
> `ServiceName` instead of the dotted `"service.name"` attribute is a **compile error**.

## How columns work

A column argument is one of:

- **Structural field** — PascalCase, a top-level OTel schema field: `"Duration"`, `"StatusCode"`.
- **Semantic-convention attribute** — dotted canonical name: `"service.name"`, `"http.route"`. The builder auto-resolves it (resource prefixes like `service.`/`k8s.`/`host.` → `ResourceAttributes`, otherwise `SpanAttributes`).
- **Explicit attribute ref** — `{ container, key }` for a non-standard key: `{ container: "SpanAttributes", key: "my.custom.attr" }`.

Containers for traces: **`SpanAttributes`** (span-specific) and **`ResourceAttributes`** (process/host/service).

## Structural columns

| Column                                    | Notes                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `TraceId`, `SpanId`, `ParentSpanId`       | IDs; `ParentSpanId` empty on root spans (call chain)                                                 |
| `SpanName`                                | Operation name                                                                                       |
| `SpanKind`                                | `Internal` \| `Server` \| `Client` \| `Producer` \| `Consumer`                                       |
| `StatusCode`                              | **`"Unset"` \| `"Ok"` \| `"Error"`** (type-checked literal). Successful spans are usually `"Unset"`. |
| `StatusMessage`                           | Error detail / exception summary                                                                     |
| `Duration`                                | Filter with duration strings (`"1s"`, `"2h"`); **result rows report nanoseconds**                    |
| `Timestamp`                               | Span start time                                                                                      |
| `TraceState`, `ScopeName`, `ScopeVersion` | Scope/trace metadata                                                                                 |

> `ServiceName` is **not** a structural column — reference the service via the dotted
> `"service.name"` attribute (resolves to `ResourceAttributes`).

## Common semantic-convention attributes (dotted)

- **Resource**: `service.name`, `service.namespace`, `service.version`, `deployment.environment.name`, `host.name`, `k8s.pod.name`, `k8s.namespace.name`, `k8s.deployment.name`, `cloud.region`, `process.runtime.name`, `telemetry.sdk.language`.
- **HTTP**: `http.request.method`, `http.response.status_code`, `http.route`, `url.path`, `url.full`, `server.address`, `client.address`.
- **DB**: `db.system.name`, `db.namespace`, `db.operation.name`, `db.query.summary`.
- **RPC**: `rpc.system.name`, `rpc.service`, `rpc.method`, `rpc.grpc.status_code`.
- **Messaging**: `messaging.system`, `messaging.destination.name`, `messaging.operation.type`.
- **Error**: `exception.type`, `exception.message`, `exception.stacktrace`, `error.type`.
- **Code**: `code.function.name`, `code.file.path`, `code.line.number`.

## Filter ops (`.where(f => …)`)

`eq(col, v)`, `neq(col, v)`, `contains/notContains/startsWith/endsWith(col, str)`,
`in/notIn(col, values[])`, `gt/gte/lt/lte(col, num)`, `isNull/isNotNull(col)`,
`and(...)`, `or(...)`. Multiple `.where()` calls are AND-combined. `in`/`notIn` values
must be all-strings or all-numbers.

```ts
.where(f => f.eq("StatusCode", "Error"))
.where(f => f.gt("Duration", "1s"))                     // units s/m/h/d/w (sub-second: ns number)
.where(f => f.eq("http.response.status_code", 500))
.where(f => f.eq("SpanKind", "Client"))                 // external calls (DB, APIs)
```

## Measure ops (aggregate mode)

`count(alias)`, `countDistinct(col, alias)`, `sum/avg/min/max(col, alias)`,
`rateAvg/rateSum/rateMax(col, alias)`, and **trace-only** `errorRate(alias)` /
`throughput(alias)`. Percentiles `p50/p75/p90/p95/p99/p999(col, alias)` are
**ClickHouse-only** (fail on SQLite).

```ts
.measure(m => m.errorRate("error_rate"))   // fraction of Error spans, server-side
.measure(m => m.throughput("rps"))         // spans/sec
.measure(m => m.avg("Duration", "avg_ns")) // portable latency (returns nanoseconds)
.measure(m => m.max("Duration", "max_ns")) // returns nanoseconds
```

Shape the query with `.dimension(col)` (GROUP BY, repeatable), `.having(alias, op, value)`
(`op ∈ eq|neq|gt|gte|lt|lte`), `.orderByMeasure(alias, "desc")` / `.orderByDimension(col)`,
`.timeRelative("1h")` or `.timeAbsolute(startISO, endISO)` (**required**), `.summary()`
or `.timeSeries("5m")` (**required**), `.limit(n)`.

## CLI fallback (quick lookups)

The CLI has no aggregation; use it for a single search. **Pass `Error` (not `ERROR`).**

| Filter             | Flag              | Example                                |
| ------------------ | ----------------- | -------------------------------------- |
| Service            | `--service`       | `--service payment`                    |
| Span name          | `--span-name`     | `--span-name "POST /checkout"`         |
| Status             | `--status-code`   | `--status-code Error`                  |
| Span kind          | `--span-kind`     | `--span-kind Client`                   |
| Min duration (ns)  | `--duration-min`  | `--duration-min 1000000000`            |
| Span attribute     | `--span-attr`     | `--span-attr "http.route=/cart"`       |
| Resource attribute | `--resource-attr` | `--resource-attr "k8s.pod.name=web-1"` |
| Trace ID           | `--trace-id`      | `--trace-id abc123`                    |

`client.searchTraces({ serviceName, statusCode, spanKind, durationMin, spanAttributes, resourceAttributes, limit })`
mirrors these (limit caps at 1000; durations are nanosecond strings). `searchTraces` is an
**async iterable** (auto-paginates) — consume with `for await (const span of client.searchTraces({…})) {…}`;
for a single page use `searchTracesPage` → `{ data, nextCursor }`.
