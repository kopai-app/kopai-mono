| title                     | impact   | tags                    |
| ------------------------- | -------- | ----------------------- |
| Step 1: Find Error Traces | CRITICAL | workflow, errors, step1 |

## Step 1: Find Error Traces

**Impact:** CRITICAL

First step in RCA workflow — locate errors across traces and logs. Lead with the
SDK; the CLI is a one-off fallback. Snippets assume the SKILL.md bootstrap
(`const client = clientFromConfig()`, `import { kq, KopaiQueryBuildError } from "@kopai/sdk"`).
Run with `npx tsx find-errors.mts` (**`.mts`** = ESM, so top-level `await` works).

### 1a. Rank services by error rate (start here)

Don't grep for errors blind — let the backend tell you _which_ service is failing.
`errorRate` counts `Error` spans server-side, dodging the `StatusCode` casing trap:

```ts
const q = kq.traces
  .aggregate()
  .measure((m) => m.errorRate("error_rate")) // fraction of Error spans, server-side
  .measure((m) => m.throughput("rps")) // spans/sec
  .measure((m) => m.count("spans"))
  .dimension("service.name")
  .timeRelative("1h")
  .summary()
  .orderByMeasure("error_rate", "desc")
  .build();
const { data } = await client.queryTracesAggregate(q);
console.log(JSON.stringify(data, null, 2));
```

### 1b. Pull the error traces

Top-ranked service in hand, fetch its failing traces. Use the `errorRate` measure to
_find_ errors; filter raw `StatusCode` only to _list_ them. The value is the literal
`"Error"` (title case — never `"ERROR"`):

```ts
const q = kq.traces
  .raw()
  .where((f) => f.eq("StatusCode", "Error"))
  .timeRelative("1h")
  .limit(20)
  .build();
const { data, nextCursor } = await client.queryTracesRaw(q);
```

Or skip the builder for a quick list — `client.searchTraces({ statusCode: "Error", limit: 20 })` is an
**async iterable** (auto-paginates): `for await (const span of client.searchTraces({ statusCode: "Error", limit: 20 })) { … }`,
never `await` it as an array. For one page use `client.searchTracesPage({ statusCode: "Error", limit: 20 })` → `{ data, nextCursor }`.

### 1c. Find error logs by severity number

Filter on **`SeverityNumber >= 17`**, not `SeverityText`. `SeverityNumber` is
standardized by the OTel Log Data Model and always means error-level; `SeverityText`
is free-form and varies by language/framework (`ERROR`, `error`, `Error`, or empty),
so it silently misses logs.

```ts
const q = kq.logs
  .raw()
  .where((f) => f.gte("SeverityNumber", 17))
  .timeRelative("1h")
  .limit(50)
  .build();
const { data, nextCursor } = await client.queryLogsRaw(q);
```

| SeverityNumber | Level |
| -------------- | ----- |
| 1–4            | TRACE |
| 5–8            | DEBUG |
| 9–12           | INFO  |
| 13–16          | WARN  |
| 17–20          | ERROR |
| 21–24          | FATAL |

### 1d. Find hidden errors (fallback — ALWAYS run)

Some services log real errors at INFO severity or with no severity set — those never
appear in 1c. Search the log `Body` text as a fallback. Run these **even when 1a–1c
return results**, because app-level errors are often logged at INFO or only in body text:

```ts
for (const term of ["error", "exception", "failed"]) {
  const q = kq.logs
    .raw()
    .where((f) => f.contains("Body", term))
    .timeRelative("1h")
    .limit(20)
    .build();
  const { data } = await client.queryLogsRaw(q);
  console.log(term, data.length);
}
```

### Handling limit saturation

If a raw query returns **exactly** its `.limit()`, more errors are hidden beyond it.
Do NOT stop — continue exploring:

1. **Switch to an aggregate grouped by `service.name`** to see the full distribution
   instead of a truncated list, and spot if one noisy service dominates:

   ```ts
   const q = kq.logs
     .aggregate()
     .measure((m) => m.count("n"))
     .dimension("service.name")
     .where((f) => f.gte("SeverityNumber", 17))
     .timeRelative("1h")
     .summary()
     .orderByMeasure("n", "desc")
     .build();
   const { data } = await client.queryLogsAggregate(q);
   ```

2. **Raise the limit or paginate** via `nextCursor` (from `queryLogsRaw`) to ensure you're not missing
   app-level errors hidden behind a noisy service.
3. **Always run the hidden-error `Body` searches (1d)** — real app errors are often
   logged at INFO severity or only appear in body text.

A single noisy service (e.g. otel-collector infrastructure errors) can fill the entire
result set and hide critical application errors.

### Filter by service

Scope any query to one service with the dotted `"service.name"` attribute:

```ts
kq.traces
  .raw()
  .where((f) => f.eq("StatusCode", "Error"))
  .where((f) => f.eq("service.name", "payment"))
  .timeRelative("1h")
  .limit(20)
  .build();

kq.logs
  .raw()
  .where((f) => f.gte("SeverityNumber", 17))
  .where((f) => f.eq("service.name", "payment"))
  .timeRelative("1h")
  .limit(50)
  .build();
```

## CLI fallback (quick one-offs)

No aggregation or `errorRate` here — single lookups only. Pass `Error` (not `ERROR`)
and `--severity-min 17`.

```bash
npx @kopai/cli traces search --status-code Error --limit 20 --json
npx @kopai/cli logs search --severity-min 17 --limit 20 --json
# hidden errors (run these too):
npx @kopai/cli logs search --body "error" --limit 20 --json
npx @kopai/cli logs search --body "exception" --limit 20 --json
# scope to a service:
npx @kopai/cli traces search --status-code Error --service payment --json
npx @kopai/cli logs search --severity-min 17 --service payment --json
```

### Reference

See references/trace-filters.md and references/log-filters.md for all filter and measure options.
