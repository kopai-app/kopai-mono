---
"@kopai/core": patch
"@kopai/mcp": minor
---

Tell the agent which levers control the size of a result, before it queries.

The `KopaiQuery` schema is shared with the REST routes, and part of what it
said was true there and false here: its `limit` field advertised
`Hard cap = 10000`, which is REST's cap, while this tool refuses anything above
200 raw or 500 aggregate. A model reading the field-level description — the
text nearest the decision — wrote a limit it would be refused for.

`@kopai/mcp` now rewrites descriptions in the copy of the schema it advertises,
leaving the shared one alone. `limit` states the caps this tool enforces and
that it refuses rather than lowers; `granularity` says a time series returns a
row per group per bucket, so halving it doubles the rows; `dimensions` says the
row count is the distinct groupings multiplied by the bucket count, and that a
high-cardinality column can exceed the cap by itself. Matching is by
description prefix, and a test asserts every override still matches something,
so a reworded schema fails loudly instead of quietly dropping the guidance.

The `query` tool description gains three sentences: that the row cap applies to
groups times buckets rather than to records scanned; that ranking over time
takes two calls, a `summary` to find the top groups and a `timeSeries` filtered
to them; and that `metrics_discover` reports attribute values, which is how to
judge a grouping column's cardinality before querying.

`@kopai/core` gains the two `dimensions` descriptions that were missing
entirely from the logs and metrics aggregate branches — only traces documented
that field. Additive, and REST callers see them too.
