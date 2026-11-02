---
"@kopai/mcp": minor
---

New `hostTools` option on `mcpRoutes`: the host application can add its own
tools to the same MCP server as `query` and `metrics_discover`.

- `names` lists every tool the host may add. It is checked when the plugin is
  registered: a name that is not an MCP tool name, a duplicate, or a built-in
  name is refused with a `TypeError`.
- `register(server, request)` runs on each request's server after the built-in
  tools, so a host can give each caller a different set of tools. Registering,
  or renaming a tool to, a name not in `names` fails the request, as do a
  rename onto a name already registered, an `outputSchema` on a host tool, and
  any throw from `register`. All are logged.
- Host tools are observed like the built-ins: a throw becomes a logged
  `upstream_error` ("The tool call could not be completed."), the outcome is read from the result's `error` code, and
  `onToolCall` fires once per call (without `rowCount`).

`ToolCallOutcome`, `ToolErrorCode` and the observer's outcome gain two codes,
`not_found` and `forbidden`, for host tools. The built-in tools never return
them. The outcome list is also exported as `TOOL_CALL_OUTCOMES`. A consumer
with an exhaustive `switch` over `ToolCallOutcome` needs the two new cases.

`McpServer` and `fromJsonSchema` are re-exported from
`@modelcontextprotocol/server` 2.3.1, the version this package pins, so a host
uses this package's copy of the SDK. `BUILT_IN_TOOL_NAMES` and the `HostTools`
type are exported too.
