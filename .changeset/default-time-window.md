---
"@kopai/core": minor
"@kopai/clickhouse-datasource": minor
"@kopai/sqlite-datasource": minor
---

A span search, log search or trace summaries request with no time range now
covers the last 24 hours instead of all stored data. With only
`timestampMax`, it covers the 24 hours before it. A span or log lookup by
`traceId` is not limited. On a large workspace an unbounded search ran past
the request timeout and failed (KOP-216). Metrics are unchanged.

`@kopai/core` exports the rule as `dataFilterSchemas.withDefaultTimeWindow`
and `dataFilterSchemas.DEFAULT_TIME_WINDOW_MS`, and documents it on the `timestampMin` and
`timestampMax` fields. Pass `timestampMin: "0"` to search all stored data.

Trace summaries also skip a redundant `TraceId IN (…)` subquery when the time
range is the only filter.
