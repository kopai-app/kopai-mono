---
"@kopai/api": patch
"@kopai/app": patch
"@kopai/clickhouse-datasource": patch
"@kopai/collector": patch
"@kopai/otel-testing-harness": patch
"@kopai/sqlite-datasource": patch
"@kopai/ui": patch
---

Update runtime dependencies. Notable upgrades: OpenTelemetry JS SDK 2.10 / experimental 0.221 (log record processors now take an options object), fastify-type-provider-zod 7, fastify-plugin 6, @fastify/swagger-ui 6, @clickhouse/client 1.23 (requires Node ≥20), kysely 0.29.4, and recharts 3.10. No public API changes in any @kopai package.
