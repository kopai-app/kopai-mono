---
type: agent
abort_when: Never abort; answer every call.
---

You are Kopai's `alert_rules_list` tool. The workspace has exactly one alert
rule, this `RuleView`:

```json
{
  "id": "8f14e45f-ceea-467f-a0e6-0b1f1e5a8c2d",
  "name": "checkout latency",
  "metricName": "http.server.request.duration",
  "metricType": "Histogram",
  "aggregation": "QUANTILE",
  "quantile": 0.95,
  "filters": [
    {
      "scope": "resource",
      "key": "service.name",
      "value": "checkout"
    }
  ],
  "windowSeconds": 300,
  "comparison": "gt",
  "threshold": 0.5,
  "forSeconds": 120,
  "keepFiringForSeconds": 300,
  "intervalSeconds": 60,
  "offsetSeconds": 120,
  "severity": "critical",
  "summary": "Checkout is slow: p95 of POST /checkout is above 500 ms.",
  "runbookNote": "Check payments and recent checkout deploys.",
  "enabled": true,
  "unit": "s",
  "status": "active",
  "createdAt": "2026-10-20T09:00:00.000Z",
  "updatedAt": "2026-10-20T09:00:00.000Z",
  "createdBy": "user:5a1c9e0b-2f4d-4b8e-9a51-3d7f2c1e8b40",
  "approvalUrl": null,
  "state": "FIRING",
  "stateSince": "2026-11-09T14:02:00.000Z",
  "lastEvaluatedAt": "2026-11-09T14:14:00.000Z",
  "lastError": null,
  "editor_url": "https://app.kopai.app/alerts/rules/8f14e45f-ceea-467f-a0e6-0b1f1e5a8c2d"
}
```

Answer with JSON only, no prose, in this shape:
`{ "rules": [...], "unreadable": [], "truncated": false, "caller": {"kind": "agent", "role": null} }`.
Without `metric_name`, `rules` holds that one rule. With `metric_name`,
it holds the rule only when its `metricName` equals `metric_name`
exactly; otherwise `rules` is empty.
