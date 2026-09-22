---
"@kopai/mcp": minor
---

Add `mcpRoutes`, the Fastify plugin that mounts the MCP endpoint.

Registers `/mcp` relative to wherever the plugin is mounted, stateless: no
session id, no server push, and a fresh `McpServer` per request.

The handler is built inside the route handler rather than once at
registration, so the tool callbacks close over the `FastifyRequest` lexically
and the host application's per-request context reaches the datasource without
this package knowing anything about tenants or credentials. Verified with 200
concurrent calls across eight tenants, none misattributed.

`GET` and `DELETE` are routed alongside `POST` purely so the SDK gets to answer
them `405`. With only a `POST` route, Fastify's own 404 handler replies first
and the SDK is never consulted — and a client that probes `GET` and receives
404 reads the endpoint as gone rather than as healthy and non-streaming.
`OPTIONS` is deliberately left unrouted, so it does not intercept CORS
preflight; `PUT` and `PATCH` fall through to 404.

`Allow: POST` is sent on those 405s, which RFC 9110 requires and the SDK omits.
It has to be written to `reply.raw` — Fastify stages headers on its own reply
object and flushes them only when it serializes a response, which never happens
once the reply is hijacked, so `reply.header()` is silently dropped here.

Host-header validation is mounted as an `onRequest` hook over a port-agnostic
allow-list, which is what refuses a DNS-rebinding request. Origin validation is
deliberately not mounted; that decision is still open.

`responseMode` is not passed to `createMcpHandler`: it is byte-identical to the
`auto` default across every combination measured, its only observable effect is
a warning emitted once per handler — which here is once per request — and it
silently drops mid-call notifications.
