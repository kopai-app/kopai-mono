---
"@kopai/mcp": minor
---

New outcome `query_too_expensive`, for a query the datasource stopped at a
resource limit: ClickHouse codes 158, 159, 160, 241, 307 and 396 (rows,
timeout, estimated time, memory, bytes). These used to be `upstream_error`
with "The query could not be completed."; they now carry a message and
`remedies` the caller can act on (narrow the window, filter, prefer
SUM/COUNT/MAX over INCREASE/RATE/HISTOGRAM_QUANTILE). `metrics_discover`
returns the same code with remedies that need no arguments, and a host tool
that throws one is classified the same way. The error is still logged.

Two failures stay `upstream_error`, because asking for less does not help:
`@clickhouse/client`'s own "Timeout error.", which also fires for a server
that stopped answering, and a 241 for the server as a whole ("(total) memory
limit exceeded"). For a heavy query to be classified, the host should set
ClickHouse's `max_execution_time` below the client's `request_timeout`.

`ToolCallOutcome` and `TOOL_CALL_OUTCOMES` gain the value, so a host counting
outcomes gets a new label.
