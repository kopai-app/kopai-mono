---
"@kopai/api": patch
"@kopai/app": patch
"@kopai/clickhouse-datasource": minor
"@kopai/collector": patch
"@kopai/otel-testing-harness": patch
"@kopai/sqlite-datasource": patch
"@kopai/ui": patch
"@kopai/ui-core": patch
---

Update runtime dependencies. Notable upgrades: OpenTelemetry JS SDK 2.10 / experimental 0.221 (log record processors now take an options object), fastify-type-provider-zod 7, fastify-plugin 6, @fastify/swagger-ui 6, kysely 0.29.4, and recharts 3.10. @kopai/clickhouse-datasource also bumps @clickhouse/client to 1.23, which raises its Node.js requirement to >=20. @kopai/ui and @kopai/ui-core now require react >=19.2.8 as a peer. No public API changes in any @kopai package.
