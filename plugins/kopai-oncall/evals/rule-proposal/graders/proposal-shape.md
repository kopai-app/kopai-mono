---
type: llm
---

PASS if the reply proposes one new rule on the http.client.request.duration histogram for checkout's calls to payments.internal (a QUANTILE with a quantile between 0 and 1, or a RATE of errors), with the threshold in seconds, gives the rule as JSON in a code block, states the backtest result as an estimate with the range it covered, and asks a person to review and save it through the link.
FAIL if it proposes changing the existing "checkout latency" rule as the only answer, gives the threshold in milliseconds in the JSON, omits the JSON or the backtest, or claims the rule was created.
