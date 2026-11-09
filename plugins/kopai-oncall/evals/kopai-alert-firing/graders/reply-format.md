---
type: llm
---

The reply is for a Slack channel where some readers have no Kopai login.

PASS if all of these hold:

- near its top (a one-line notice that on-call setup has not run may come first) it states the alert's state and how long it has been firing (since 14:02 UTC, about 12 minutes);
- it gives the observed value against the threshold, using the exact texts "p95 ≈ 2.1 s" and "500 ms" (no recomputed or rounded values in their place);
- it names at least one finding with the number it rests on and the time window of the query behind it;
- it points at checkout's 1.5.0 deploy around 13:58 UTC and its payments client timeouts as the likely cause, while saying payments itself looks healthy;
- it proposes a fix (such as rolling back checkout 1.5.0 or restoring the timeout) without claiming to have carried it out;
- it links the Kopai incident page, saying a Kopai login is needed.

FAIL if any of those is missing, if it blames payments, or if it claims the incident is resolved.
