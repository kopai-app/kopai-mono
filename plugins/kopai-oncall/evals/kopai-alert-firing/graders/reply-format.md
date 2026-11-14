---
type: llm
---

The reply is for a Slack channel where some readers have no Kopai login. Judge the reply meant for the alert's thread (ignore any note to the operator around it).

PASS if all of these hold:

- it is short: a few lines a person reads in seconds, not a full report with sections such as "Blast radius", "Ruled out" or "Would change my mind";
- near its top (a one-line notice that on-call setup has not run may come first) it states the alert's state and how long it has been firing (since 14:02 UTC, about 12 minutes);
- it gives the observed value against the threshold, using the exact texts "p95 ≈ 2.1 s" and "500 ms";
- it names checkout's 1.5.0 release around 13:58 UTC as the likely cause, with at least one number and its time window (naming the payments calls or their timeouts is a plus, not required);
- it says what to look at first or proposes a fix (such as rolling back checkout 1.5.0) without claiming to have done it;
- it ends with the Kopai incident link, saying a Kopai login is needed, with nothing substantial after it.

FAIL if any of those is missing, if it blames payments, or if it claims the incident is resolved.
