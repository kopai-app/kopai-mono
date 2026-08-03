---
"@kopai/ui": patch
---

Fixed the trace search form keeping filters from a previous search after browser back/forward. The form now rebuilds itself whenever the committed search changes, so a service can no longer be paired with an operation belonging to a different one. Filters carried in the URL — operation, tags, lookback, durations and limit — are also restored into the form on load, where previously only the service was and the rest were silently dropped on the next submit. The operation list now waits for the service picker to settle before fetching, instead of issuing a request per service arrowed past.
