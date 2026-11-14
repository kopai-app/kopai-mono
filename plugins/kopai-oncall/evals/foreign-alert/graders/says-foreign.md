---
type: llm
---

PASS if the reply says, in a line or less, that this alert did not come from Kopai's alerting (it came from Alertmanager or Prometheus) and that the evidence is from Kopai's telemetry, and it diagnoses checkout's errors with evidence (checkout 1.5.0 and its payments timeouts). It may mention and link a separate Kopai alert that it correlated with this one, as long as it presents that as a different alert.
FAIL if it presents the Alertmanager alert itself as a Kopai alert, gives it a Kopai incident link, or gives no evidence-backed diagnosis.
