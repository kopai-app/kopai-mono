---
description: A Kopai FIRING card lands; Claude reads it by event id and replies with a self-sufficient diagnosis.
tags: [triage, kopai-alert]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Skill, Read, Glob, Grep]
---

A new message was just posted in #alerts by the Kopai app. Its text:

> FIRING · checkout latency · Checkout is slow: p95 of POST /checkout is above 500 ms.

Its attachment:

> 🔴 FIRING
> _<https://app.kopai.app/alerts/rules/8f14e45f-ceea-467f-a0e6-0b1f1e5a8c2d/incidents/812|checkout latency>_
> Checkout is slow: p95 of POST /checkout is above 500 ms.
> Observed value: p95 ≈ 2.1 s · Threshold: above 500 ms
> Metric: http.server.request.duration (Histogram) · Aggregation: p95 over a 5 min (300 s) window
> Filters: resource service.name = checkout · Window (UTC): 13:55–14:00
> Severity: critical · Fired at: 2026-11-09 14:02 UTC

It is now 2026-11-09 14:14 UTC.

Triage it and write the reply you would post in its thread. Answer with only the message(s) you would post there, nothing addressed to me.
