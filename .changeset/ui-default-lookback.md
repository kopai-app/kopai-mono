---
"@kopai/ui": minor
---

The Traces and Logs pages open on "Last 1 Hour" and no longer offer "All
time". On a large workspace an all-time search ran past the request timeout
and the page showed "Request timed out" (KOP-216). An absolute time range in
the URL is kept as it is. Switching the Logs filter back to Lookback selects
"Last 1 Hour".
