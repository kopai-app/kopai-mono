# Log query reference

Columns, filters, and measures for `kq.logs.aggregate()` / `kq.logs.raw()` (and the
`client.searchLogs(...)` filter shape). Run a built query with the typed method:
`client.queryLogsAggregate(q)` or `client.queryLogsRaw(q)` (prefer these over the
loosely-typed `client.query(q)`).

## How columns work

Same rules as traces: PascalCase = structural field, dotted = semantic-convention
attribute (auto-resolved), `{ container, key }` = explicit. Log containers:
**`LogAttributes`** (record-specific), **`ResourceAttributes`** (process/host/service),
**`ScopeAttributes`** (instrumentation scope).

## Structural columns

| Column                                                 | Notes                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `Body`                                                 | Log message content                                                        |
| `SeverityNumber`                                       | **Numeric severity (use this for error detection)** — see scale below      |
| `SeverityText`                                         | Free-form level string; varies by language (`ERROR`/`error`/`Error`/empty) |
| `TraceId`, `SpanId`                                    | Correlate to a trace/span                                                  |
| `Timestamp`                                            | Event time                                                                 |
| `EventName`, `TraceFlags`, `ScopeName`, `ScopeVersion` | Record/scope metadata                                                      |

> No `ServiceName` structural column — use the dotted `"service.name"` attribute.

## Severity model (canonical error detector)

Filter errors by **`SeverityNumber >= 17`** rather than `SeverityText`. `SeverityNumber`
is standardized by the OTel Log Data Model; `SeverityText` is free-form and inconsistent.

| Level | Number |                                                               |
| ----- | ------ | ------------------------------------------------------------- |
| TRACE | 1–4    |                                                               |
| DEBUG | 5–8    |                                                               |
| INFO  | 9–12   | Some apps log real errors here — fall back to a `Body` search |
| WARN  | 13–16  |                                                               |
| ERROR | 17–20  | `f.gte("SeverityNumber", 17)`                                 |
| FATAL | 21–24  |                                                               |

```ts
kq.logs
  .raw()
  .where((f) => f.gte("SeverityNumber", 17))
  .timeRelative("1h")
  .limit(50)
  .build();
kq.logs
  .raw()
  .where((f) => f.eq("TraceId", traceId))
  .timeRelative("1h")
  .build(); // correlate
kq.logs
  .raw()
  .where((f) => f.contains("Body", "connection refused"))
  .timeRelative("1h")
  .build();
```

## Common semantic-convention attributes (dotted)

`log.level`, `log.file.path`, `exception.type`, `exception.message`,
`exception.stacktrace`, `error.type`, `code.function.name`, `code.file.path`,
`http.request.method`, `http.response.status_code`, `http.route`, `url.path`,
`client.address`, plus the resource set (`service.name`, `k8s.pod.name`, …).

## Filter & measure ops

Filters: same DSL as traces (`eq/neq/contains/startsWith/in/gt/gte/lt/lte/isNull/and/or`).
Aggregate measures: `count`, `countDistinct`, `sum/avg/min/max`, `rate*`. (No `errorRate`/
`throughput` — those are trace-only.) Every query needs a time window + `.summary()`/`.timeSeries()`.

```ts
// error volume by service + severity over time
kq.logs
  .aggregate()
  .measure((m) => m.count("n"))
  .dimension("service.name")
  .dimension("SeverityText")
  .where((f) => f.gte("SeverityNumber", 17))
  .timeRelative("3h")
  .timeSeries("5m")
  .orderByMeasure("n", "desc")
  .build();
```

## CLI fallback (quick lookups)

| Filter            | Flag                                | Example                           |
| ----------------- | ----------------------------------- | --------------------------------- |
| Service           | `--service`                         | `--service payment`               |
| Severity min/max  | `--severity-min` / `--severity-max` | `--severity-min 17`               |
| Body search       | `--body`                            | `--body "connection refused"`     |
| Trace correlation | `--trace-id`                        | `--trace-id abc123`               |
| Log attribute     | `--log-attr`                        | `--log-attr "error.type=timeout"` |

`client.searchLogs({ serviceName, severityNumberMin, bodyContains, traceId, logAttributes, limit })` mirrors these (field is `bodyContains`, not `body`). `searchLogs` is an **async iterable** — use `for await (const log of client.searchLogs({…})) {…}`, don't `await` it as an array; for one page use `searchLogsPage` → `{ data, nextCursor }`.
