# ClickHouse Migrations

## 001 - Add EventName to otel_logs

**File:** `001_add_event_name_to_otel_logs.sql`

Adds the `EventName` column required by OTEL collector v0.148.0+.

### Running the migration

The SQL file assumes the correct database is selected in the client context. Use one of:

```bash
# Via clickhouse-client with --database flag
clickhouse-client --database=otel_default < 001_add_event_name_to_otel_logs.sql

# Or prefix the table name manually
ALTER TABLE otel_default.otel_logs ADD COLUMN IF NOT EXISTS EventName String CODEC(ZSTD(1)) AFTER LogAttributes;
```

### Post-migration deprecation

Once all production databases have been migrated and the new collector is running everywhere, the following backward-compatibility code can be removed:

| Item                            | File                                                                            | Change                                    |
| ------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------- |
| `EventName` optional → required | `packages/core/src/denormalized-signals-zod.ts`                                 | Change `.optional()` to just `.string()`  |
| `EventName` optional → required | `packages/clickhouse-datasource/src/ch-row-schemas.ts`                          | Change `chOptionalString` to `z.string()` |
| Migration test                  | `packages/clickhouse-datasource/src/migration.integration.test.ts`              | Delete entirely                           |
| Old collector constant          | `packages/clickhouse-datasource/src/test/constants.ts`                          | Remove `OTEL_COLLECTOR_VERSION_OLD`       |
| This migration script           | `packages/clickhouse-datasource/migrations/001_add_event_name_to_otel_logs.sql` | Archive (keep for history)                |
