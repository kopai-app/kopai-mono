---
type: llm
---

PASS if the output tells the channel that Kopai is connected with a person's own login (an owner's), that everyone in the channel therefore acts as that person in Kopai, and that a Claude admin should switch to a Kopai agent token; and it still gives a diagnosis of the alert.
FAIL if it does not mention the login problem, if it repeats the warning more than once, or if it refuses to triage because of it.
