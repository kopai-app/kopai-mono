---
"@kopai/ui": patch
---

Make the Tags filter on the traces page actually filter.

Two silent failures stacked: the parsed tags were sent under a `tags` key, which
`traceSummariesFilterSchema` does not define, so zod stripped it before the
request left the SDK; and the logfmt key pattern excluded `.`, clipping dotted
OpenTelemetry attribute names to their last segment
(`http.request.method=GET` parsed as `{ method: "GET" }`).

Tags are now sent as `spanAttributes` with their keys intact. Note that they
match span attributes only — resource-level attributes such as
`deployment.environment` are not searched by this box.
