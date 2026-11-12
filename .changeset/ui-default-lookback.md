---
"@kopai/ui": minor
---

The Traces and Logs pages open on "Last 1 Hour" and no longer offer "All
time". On a large workspace an all-time search ran past the request timeout
and the page showed "Request timed out" (KOP-216). An absolute time range in
the URL is kept: the trace search shows it as "Custom range" and keeps it when
other filters are submitted, and the Logs filter opens in Absolute mode with
its bounds. A log search by trace ID is not limited to the last hour.
Switching the Logs filter back to Lookback selects "Last 1 Hour".
