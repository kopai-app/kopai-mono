-- Migration: Add EventName column to otel_logs
-- Required when upgrading OTEL collector from v0.136.0 to v0.148.0
-- Run BEFORE starting the new collector version.
--
-- ClickHouse ALTER TABLE ADD COLUMN is online and non-blocking.
-- Existing rows get the default empty string value.
--
-- NOTE: This script assumes the correct database is selected in the client
-- context (e.g. via `USE otel_default` or the `--database` CLI flag).
-- If running from a different context, qualify the table name:
--   ALTER TABLE otel_default.otel_logs ADD COLUMN IF NOT EXISTS ...

ALTER TABLE otel_logs ADD COLUMN IF NOT EXISTS EventName String CODEC(ZSTD(1)) AFTER LogAttributes;
