| title                    | impact | tags                       |
| ------------------------ | ------ | -------------------------- |
| Pattern: HTTP 500 Errors | HIGH   | pattern, http, 500, errors |

## Pattern: HTTP 500 Errors

**Impact:** HIGH

Diagnose HTTP 500 / internal server errors. Lead with an SDK script that ranks failing
endpoints by error rate, then drill into one trace and correlate its error logs.

### Code mode (recommended)

Run: `npx tsx http-errors.mts`. Assumes the SKILL.md bootstrap
(`const client = clientFromConfig()`, `import { kq, KopaiQueryBuildError } from "@kopai/sdk"`).

**1. Rank failing endpoints** — `errorRate` counts `"Error"` spans server-side:

```ts
try {
  const q = kq.traces
    .aggregate()
    .measure((m) => m.errorRate("error_rate"))
    .measure((m) => m.count("n"))
    .dimension("http.route")
    .dimension("service.name")
    .where((f) => f.eq("StatusCode", "Error")) // "Unset" | "Ok" | "Error"
    .timeRelative("1h")
    .summary()
    .orderByMeasure("error_rate", "desc")
    .build();
  const { data } = await client.query(q); // typed rows
  console.log(JSON.stringify(data, null, 2));
} catch (e) {
  if (e instanceof KopaiQueryBuildError) console.error(e.issues);
  else throw e;
}
```

**2. Narrow to a specific status code** — `http.response.status_code` is the semconv
attribute (a number, not `"http.status_code"`):

```ts
.where((f) => f.eq("http.response.status_code", 500))
```

Add `.measure((m) => m.max("Duration", "max_ns"))` to spot slow-and-failing routes
(`Duration` is nanoseconds: 1ms = 1e6, 1s = 1e9). Swap `.summary()` for
`.timeSeries("5m")` to see when the spike started.

**3. Pull a failing trace** — grab a `TraceId` from a failing route, then:

```ts
const spans = await client.getTrace(traceId); // inspect StatusMessage, Duration, ParentSpanId
```

**4. Correlate error logs** to that trace (`SeverityNumber >= 17`, not `SeverityText`):

```ts
const logs = kq.logs
  .raw()
  .where((f) => f.eq("TraceId", traceId))
  .where((f) => f.gte("SeverityNumber", 17))
  .timeRelative("1h")
  .build();
const { data } = await client.query(logs); // raw query → { data, nextCursor }
```

For a known signature, body-substring instead: `.where((f) => f.contains("Body", "connection refused"))`.

### Key attributes to check (semconv)

| Attribute                   | Purpose                         |
| --------------------------- | ------------------------------- |
| `http.response.status_code` | HTTP response code (number)     |
| `http.route`                | Endpoint that failed            |
| `exception.message`         | Error description               |
| `exception.type`            | Exception class                 |
| `error.type`                | Error category / classification |

### CLI fallback (quick one-offs)

For a single lookup. Note the status value is the literal `Error`, and HTTP status is
the semconv attribute `http.response.status_code`:

```bash
npx @kopai/cli traces search --status-code Error --span-attr "http.response.status_code=500" --json
npx @kopai/cli traces get <traceId> --json
npx @kopai/cli logs search --trace-id <traceId> --severity-min 17 --json
```

### Reference

- [trace-filters](../references/trace-filters.md), [log-filters](../references/log-filters.md)
- https://opentelemetry.io/docs/specs/semconv/http/
