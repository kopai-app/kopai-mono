---
"@kopai/api": minor
---

A query the datasource stopped at a resource limit (ClickHouse codes 158,
159, 160, 241, 307 and 396) now answers 422 "Query too expensive" with a
`detail` saying how to ask for less, instead of a bare 500 "Internal server
error". It is logged at warn. `@clickhouse/client`'s own "Timeout error." and
a server-wide memory limit stay 500s, as they are not the caller's to fix.
