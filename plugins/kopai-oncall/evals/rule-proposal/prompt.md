---
description: After an incident, Claude proposes a Kopai rule as an editor link plus JSON and a backtest, without creating or changing rules.
tags: [rules]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Skill, Read, Glob, Grep, Bash]
---

Postmortem thread for INC-2041 (2026-11-09): checkout 1.5.0 lowered its HTTP
client timeout to payments to 200 ms at 13:58 UTC, and calls to
payments.internal started timing out. Our checkout latency alert fired at
14:02 UTC, but only after customers felt it.

Would a Kopai alert rule have caught this earlier? If so, propose it here
for us to install.
