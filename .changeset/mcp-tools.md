---
"@kopai/mcp": minor
---

Add the two read-only tools, `query` and `metrics_discover`.

`query` takes one KopaiQuery under a `query` property and returns the same
JSON the REST query routes return. `metrics_discover` takes no arguments and
returns the metric discovery payload. Both declare `readOnlyHint`,
`idempotentHint` and `openWorldHint: false`, and neither advertises an
`outputSchema`.

Every result carries its payload in **both** channels — as
`structuredContent` and as one text block holding exactly `JSON.stringify` of
the same object. The two consumers read different channels and neither reads
both: a live page reads the structured value, while a conversational agent
reads `content` and discards `structuredContent` whenever `content` is
non-empty. Rows in one channel and a prose summary in the other is the single
combination that fails silently, and it fails hardest on the error path, where
the fallback to the structured value never fires at all.

Row caps are per mode — 200 raw, 500 aggregate — because a raw row is an order
of magnitude larger than an aggregate one, and at 500 every raw shape overruns
the 150,000-character ceiling. An over-cap `limit` is refused, never clamped: a
caller that asked for 500 rows and silently got 200 would read the result as
complete.

An aggregate query runs one row over its cap so an overflow is detectable. Over
the cap **with** an `orderBy` the result is truncated and says so; **without**
one it is refused outright, because the aggregate compiler emits no `ORDER BY`
when `orderBy` is absent, so a limit would drop an arbitrary subset — and for a
time series that yields a scatter of (group, bucket) pairs that reads as real
data and is not.

Errors are `isError: true` with a `{ error, message, issues?, remedies? }`
payload, `error` first so the serialized JSON opens with the code. Codes reuse
the four outcome labels. A `KopaiQueryValidationError` becomes `invalid_input`
carrying its own message; anything unrecognised becomes `upstream_error` with a
generic string, mirroring the REST handler's no-leak posture.

The `query` tool is registered with a pass-through validator so the handler is
what validates — the SDK's default would reject before dispatch with one line
listing all six branches, recompile the schema on every request, and hide
`invalid_input` from the observer.
