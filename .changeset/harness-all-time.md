---
"@kopai/otel-testing-harness": patch
---

`getTraces` and `getLogs` keep returning stored data of any age when the
filter has no `timestampMin`, so fixtures with fixed timestamps still match.
The underlying datasource now limits such searches to the last 24 hours;
`harness.datasource` follows that rule.
