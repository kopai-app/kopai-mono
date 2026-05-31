| title                  | impact   | tags                               |
| ---------------------- | -------- | ---------------------------------- |
| Step 3: Correlate Logs | CRITICAL | workflow, logs, correlation, step3 |

## Step 3: Correlate Logs with Trace

**Impact:** CRITICAL

Pull the logs tied to a trace, then find the **earliest error message + stack trace** — usually closest to root cause. Lead in code mode (`correlate.mts`, run `npx tsx correlate.mts`).

### Get All Logs for Trace

```ts
const q = kq.logs
  .raw()
  .where((f) => f.eq("TraceId", traceId))
  .timeRelative("1h")
  .build();
const { data } = await client.query(q);
console.log(JSON.stringify(data, null, 2));
```

Or the client helper (an async iterable — iterate it, never `await` it as an array):
`for await (const log of client.searchLogs({ traceId })) { console.log(log); }`. For a single page use `client.searchLogsPage({ traceId })` → `{ data, nextCursor }`.

Sort by `Timestamp` ascending — the first record is where the failure surfaced.

### Filter by Severity

Errors are detected by **`SeverityNumber >= 17`** (covers ERROR/FATAL regardless of `SeverityText` casing — `ERROR`/`error`/`Error`/empty all vary by language). Filters are AND-combined, so add a second `.where()`:

```ts
const q = kq.logs
  .raw()
  .where((f) => f.eq("TraceId", traceId))
  .where((f) => f.gte("SeverityNumber", 17))
  .timeRelative("1h")
  .build();
```

Some apps log real errors at INFO (9–12) — if nothing comes back at `>= 17`, drop the severity filter and search the `Body` instead.

### Search Log Body

```ts
const q = kq.logs
  .raw()
  .where((f) => f.eq("TraceId", traceId))
  .where((f) => f.contains("Body", "exception"))
  .timeRelative("1h")
  .build();
```

`f.contains` is a case-sensitive substring match. Try `"exception"`, `"timeout"`, `"connection refused"`, or the dotted `exception.stacktrace` attribute for the stack.

### Multiple Filters

Each `.where()` adds an AND clause — chain them to narrow the trace's error logs:

```ts
const q = kq.logs
  .raw()
  .where((f) => f.eq("TraceId", traceId))
  .where((f) => f.gte("SeverityNumber", 17))
  .where((f) => f.contains("Body", "timeout"))
  .timeRelative("1h")
  .build();
```

Equivalent via the client helper (field is `bodyContains`, not `body`). `searchLogs` is an async iterable — consume it with `for await`, don't `await` it as an array:

```ts
for await (const log of client.searchLogs({
  traceId,
  severityNumberMin: 17,
  bodyContains: "timeout",
})) {
  console.log(log);
}
// single page instead: const { data } = await client.searchLogsPage({ traceId, severityNumberMin: 17, bodyContains: "timeout" });
```

### Reference

See `references/log-filters.md` for log columns, the severity scale, and filter ops.

## CLI fallback (quick one-offs)

For a single lookup. Note severity uses `--severity-min 17` (numeric), not `--severity-text ERROR`:

```bash
npx @kopai/cli logs search --trace-id <traceId> --json
npx @kopai/cli logs search --trace-id <traceId> --severity-min 17 --json
npx @kopai/cli logs search --trace-id <traceId> --body "exception" --json
npx @kopai/cli logs search --trace-id <traceId> --severity-min 17 --body "timeout" --json
```
