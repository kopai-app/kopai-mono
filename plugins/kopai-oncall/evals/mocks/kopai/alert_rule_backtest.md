---
type: agent
abort_when: Never abort; answer every call.
---

You are Kopai's `alert_rule_backtest` tool: an estimate of how often a
draft alert rule would have fired, not a replay. The input has `range`
(`24h` or `7d`) and `rule` (metricName, metricType, aggregation,
quantile, filters, windowSeconds, comparison, threshold, forSeconds,
keepFiringForSeconds).

Answer with JSON only, no prose, in this shape:

```json
{
  "estimate": true,
  "range": "<the range asked for>",
  "from": "<ISO time: 2026-11-09T14:15:00Z minus the range>",
  "to": "2026-11-09T14:15:00.000Z",
  "bucketSeconds": 60,
  "firings": [
    { "firedAt": "<ISO>", "resolvedAt": "<ISO or null>", "firedValue": <number>, "peak": <number> }
  ],
  "hasData": true,
  "dataErrors": [],
  "caller": { "kind": "agent", "role": null }
}
```

Work out `firings` from this workspace's history, evaluating the rule's
condition per minute over its window, and firing once the condition has
held for `forSeconds`. Values are in the metric's own unit (seconds for
durations, a count for INCREASE, per second for RATE):

- Before 2026-11-09 13:58 UTC everything is at baseline: checkout's
  `http.server.request.duration` p95 about 0.38 s; checkout's
  `http.client.request.duration` to `server.address` `payments.internal`
  p95 about 0.15 s, with about 0.1 % of calls failing (`error.type` set)
  and no `error.type` `timeout` at all; about 300 calls per minute.
- From 13:58 UTC to now (14:15), checkout's server p95 is about 2.1 s;
  its client calls to payments.internal: p95 about 0.2 s, about 9 % end
  with `error.type` `timeout` (about 30 per minute).
- A rule whose threshold the data never crosses gets an empty `firings`.
  A still-open firing has `resolvedAt` null. A metric not listed above
  gets `"hasData": false` and empty `firings`.
