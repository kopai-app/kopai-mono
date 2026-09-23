---
"@kopai/mcp": patch
---

Add the integration test layer — the tools driven over JSON-RPC against a real
in-memory SQLite datasource, rather than a fake.

The unit tests assert the contract's shape; these assert its behaviour, and
they caught things a fake could not. The aggregate response genuinely carries
no `nextCursor`, where the raw response does. A metric query with no
`MetricType` filter is rejected by the datasource's own validator and arrives
as `invalid_input` at `query`. And the success payload is asserted
byte-identical to what the REST route returns for the same query — the
same-JSON-as-REST promise, now checked rather than stated.

Overflow behaviour is exercised against real rows too: an aggregate over its
cap is refused with no rows, ordered or not.
