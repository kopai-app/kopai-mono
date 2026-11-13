---
"@kopai/app": patch
"@kopai/cli": patch
"@kopai/clickhouse-datasource": patch
"@kopai/collector": patch
"@kopai/mcp": patch
"@kopai/otel-testing-harness": patch
"@kopai/sqlite-datasource": patch
"@kopai/ui": patch
---

Bump runtime dependencies (fastify 5.12.8, @fastify/swagger, @fastify/swagger-ui, commander, @clickhouse/client, @bufbuild/protobuf, @modelcontextprotocol/*, kysely, @tanstack/react-virtual). Narrow `server.addresses()` results for fastify 5.12.8's `AddressInfo | string` typing.
