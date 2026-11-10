---
description: An Alertmanager post with no Kopai link is a foreign alert; Claude triages with telemetry only and says so.
tags: [triage, foreign-alert]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Skill, Read, Glob, Grep]
---

A new message was just posted in #alerts by the Alertmanager app:

> [FIRING:1] CheckoutHighErrorRate (checkout production critical)
> Summary: checkout 5xx ratio above 5% for 5m
> Labels: alertname=CheckoutHighErrorRate, service=checkout, env=production, severity=critical
> Started: 2026-11-09 14:03 UTC
> Source: http://prometheus.internal:9090/graph?g0.expr=...

It is now 2026-11-09 14:14 UTC. Triage it and write the reply you would post in its thread. Answer with only the message(s) you would post there, nothing addressed to me.
