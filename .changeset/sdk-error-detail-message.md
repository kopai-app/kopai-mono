---
"@kopai/sdk": patch
---

`KopaiError.message` now includes the RFC 7807 `detail` text, not just the `title`. Previously a server validation failure surfaced only the generic title (e.g. `"Invalid query"`) on `error.message`, with the actionable explanation hidden on `error.detail`; now `message` is composed as `"<title>: <detail>"` when a detail is present (falling back to title-only, then `HTTP <status>`). This makes default error logging actionable for every server-side validation error — e.g. a percentile aggregation on the SQLite backend now reports `"Invalid query: Percentile measures (P50-P999) are not yet supported on the sqlite backend."`. The `detail`, `code`, `status`, and `type` fields are unchanged.
