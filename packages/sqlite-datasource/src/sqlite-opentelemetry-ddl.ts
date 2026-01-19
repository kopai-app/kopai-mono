export const ddl = `
-- OpenTelemetry SQLite Schema
-- Migrated from ClickHouse OTEL exporter schema v0.136.0
--
-- Conversion notes:
-- - Map/Array types → JSON TEXT columns
-- - DateTime64(9) → INTEGER (unix nanoseconds)
-- - LowCardinality(String) → TEXT (CH optimization removed)
-- - Removed: CODEC compression, PARTITION BY, TTL, bloom filters, MergeTree engine
-- - Skipped: otel_traces_trace_id_ts_mv materialized view
-- - Column names with dots (e.g. "Events.Timestamp") preserved for compatibility
--
-- Source: /k8s/migrations/clickhouse/002-otel-schema-v136.sql

-- =============================================================================
-- 1. LOGS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS otel_logs (
    Timestamp INTEGER NOT NULL,
    TimestampTime INTEGER GENERATED ALWAYS AS (Timestamp / 1000000000) STORED,
    TraceId TEXT NOT NULL DEFAULT '',
    SpanId TEXT NOT NULL DEFAULT '',
    TraceFlags INTEGER NOT NULL DEFAULT 0,
    SeverityText TEXT NOT NULL DEFAULT '',
    SeverityNumber INTEGER NOT NULL DEFAULT 0,
    ServiceName TEXT NOT NULL DEFAULT '',
    Body TEXT NOT NULL DEFAULT '',
    ResourceSchemaUrl TEXT NOT NULL DEFAULT '',
    ResourceAttributes TEXT NOT NULL DEFAULT '{}',
    ScopeSchemaUrl TEXT NOT NULL DEFAULT '',
    ScopeName TEXT NOT NULL DEFAULT '',
    ScopeVersion TEXT NOT NULL DEFAULT '',
    ScopeAttributes TEXT NOT NULL DEFAULT '{}',
    LogAttributes TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_otel_logs_service_time ON otel_logs (ServiceName, TimestampTime);
CREATE INDEX IF NOT EXISTS idx_otel_logs_trace_id ON otel_logs (TraceId) WHERE TraceId != '';
CREATE INDEX IF NOT EXISTS idx_otel_logs_severity ON otel_logs (SeverityNumber);

-- =============================================================================
-- 2. TRACES TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS otel_traces (
    Timestamp INTEGER NOT NULL,
    TraceId TEXT NOT NULL,
    SpanId TEXT NOT NULL,
    ParentSpanId TEXT NOT NULL DEFAULT '',
    TraceState TEXT NOT NULL DEFAULT '',
    SpanName TEXT NOT NULL DEFAULT '',
    SpanKind TEXT NOT NULL DEFAULT '',
    ServiceName TEXT NOT NULL DEFAULT '',
    ResourceAttributes TEXT NOT NULL DEFAULT '{}',
    ScopeName TEXT NOT NULL DEFAULT '',
    ScopeVersion TEXT NOT NULL DEFAULT '',
    SpanAttributes TEXT NOT NULL DEFAULT '{}',
    Duration INTEGER NOT NULL DEFAULT 0,
    StatusCode TEXT NOT NULL DEFAULT '',
    StatusMessage TEXT NOT NULL DEFAULT '',
    "Events.Timestamp" TEXT NOT NULL DEFAULT '[]',
    "Events.Name" TEXT NOT NULL DEFAULT '[]',
    "Events.Attributes" TEXT NOT NULL DEFAULT '[]',
    "Links.TraceId" TEXT NOT NULL DEFAULT '[]',
    "Links.SpanId" TEXT NOT NULL DEFAULT '[]',
    "Links.TraceState" TEXT NOT NULL DEFAULT '[]',
    "Links.Attributes" TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_otel_traces_service_span_time ON otel_traces (ServiceName, SpanName, Timestamp);
CREATE INDEX IF NOT EXISTS idx_otel_traces_trace_id ON otel_traces (TraceId);
CREATE INDEX IF NOT EXISTS idx_otel_traces_parent_span ON otel_traces (ParentSpanId) WHERE ParentSpanId != '';
CREATE INDEX IF NOT EXISTS idx_otel_traces_duration ON otel_traces (Duration);

-- =============================================================================
-- 3. TRACE LOOKUP TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS otel_traces_trace_id_ts (
    TraceId TEXT NOT NULL PRIMARY KEY,
    Start INTEGER NOT NULL,
    End INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_otel_traces_trace_id_ts_start ON otel_traces_trace_id_ts (Start);

-- =============================================================================
-- 4. METRICS - GAUGE TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS otel_metrics_gauge (
    ResourceAttributes TEXT NOT NULL DEFAULT '{}',
    ResourceSchemaUrl TEXT NOT NULL DEFAULT '',
    ScopeName TEXT NOT NULL DEFAULT '',
    ScopeVersion TEXT NOT NULL DEFAULT '',
    ScopeAttributes TEXT NOT NULL DEFAULT '{}',
    ScopeDroppedAttrCount INTEGER NOT NULL DEFAULT 0,
    ScopeSchemaUrl TEXT NOT NULL DEFAULT '',
    ServiceName TEXT NOT NULL DEFAULT '',
    MetricName TEXT NOT NULL DEFAULT '',
    MetricDescription TEXT NOT NULL DEFAULT '',
    MetricUnit TEXT NOT NULL DEFAULT '',
    Attributes TEXT NOT NULL DEFAULT '{}',
    StartTimeUnix INTEGER NOT NULL,
    TimeUnix INTEGER NOT NULL,
    Value REAL NOT NULL,
    Flags INTEGER NOT NULL DEFAULT 0,
    "Exemplars.FilteredAttributes" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.TimeUnix" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.Value" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.SpanId" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.TraceId" TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_otel_metrics_gauge_service_metric_time ON otel_metrics_gauge (ServiceName, MetricName, TimeUnix);

-- =============================================================================
-- 5. METRICS - SUM TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS otel_metrics_sum (
    ResourceAttributes TEXT NOT NULL DEFAULT '{}',
    ResourceSchemaUrl TEXT NOT NULL DEFAULT '',
    ScopeName TEXT NOT NULL DEFAULT '',
    ScopeVersion TEXT NOT NULL DEFAULT '',
    ScopeAttributes TEXT NOT NULL DEFAULT '{}',
    ScopeDroppedAttrCount INTEGER NOT NULL DEFAULT 0,
    ScopeSchemaUrl TEXT NOT NULL DEFAULT '',
    ServiceName TEXT NOT NULL DEFAULT '',
    MetricName TEXT NOT NULL DEFAULT '',
    MetricDescription TEXT NOT NULL DEFAULT '',
    MetricUnit TEXT NOT NULL DEFAULT '',
    Attributes TEXT NOT NULL DEFAULT '{}',
    StartTimeUnix INTEGER NOT NULL,
    TimeUnix INTEGER NOT NULL,
    Value REAL NOT NULL,
    Flags INTEGER NOT NULL DEFAULT 0,
    "Exemplars.FilteredAttributes" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.TimeUnix" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.Value" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.SpanId" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.TraceId" TEXT NOT NULL DEFAULT '[]',
    AggTemporality TEXT NOT NULL DEFAULT '',
    IsMonotonic INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_otel_metrics_sum_service_metric_time ON otel_metrics_sum (ServiceName, MetricName, TimeUnix);

-- =============================================================================
-- 6. METRICS - HISTOGRAM TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS otel_metrics_histogram (
    ResourceAttributes TEXT NOT NULL DEFAULT '{}',
    ResourceSchemaUrl TEXT NOT NULL DEFAULT '',
    ScopeName TEXT NOT NULL DEFAULT '',
    ScopeVersion TEXT NOT NULL DEFAULT '',
    ScopeAttributes TEXT NOT NULL DEFAULT '{}',
    ScopeDroppedAttrCount INTEGER NOT NULL DEFAULT 0,
    ScopeSchemaUrl TEXT NOT NULL DEFAULT '',
    ServiceName TEXT NOT NULL DEFAULT '',
    MetricName TEXT NOT NULL DEFAULT '',
    MetricDescription TEXT NOT NULL DEFAULT '',
    MetricUnit TEXT NOT NULL DEFAULT '',
    Attributes TEXT NOT NULL DEFAULT '{}',
    StartTimeUnix INTEGER NOT NULL,
    TimeUnix INTEGER NOT NULL,
    Count INTEGER NOT NULL DEFAULT 0,
    Sum REAL NOT NULL DEFAULT 0,
    BucketCounts TEXT NOT NULL DEFAULT '[]',
    ExplicitBounds TEXT NOT NULL DEFAULT '[]',
    "Exemplars.FilteredAttributes" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.TimeUnix" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.Value" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.SpanId" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.TraceId" TEXT NOT NULL DEFAULT '[]',
    Min REAL,
    Max REAL,
    AggTemporality TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_otel_metrics_histogram_service_metric_time ON otel_metrics_histogram (ServiceName, MetricName, TimeUnix);

-- =============================================================================
-- 7. METRICS - EXPONENTIAL HISTOGRAM TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS otel_metrics_exponential_histogram (
    ResourceAttributes TEXT NOT NULL DEFAULT '{}',
    ResourceSchemaUrl TEXT NOT NULL DEFAULT '',
    ScopeName TEXT NOT NULL DEFAULT '',
    ScopeVersion TEXT NOT NULL DEFAULT '',
    ScopeAttributes TEXT NOT NULL DEFAULT '{}',
    ScopeDroppedAttrCount INTEGER NOT NULL DEFAULT 0,
    ScopeSchemaUrl TEXT NOT NULL DEFAULT '',
    ServiceName TEXT NOT NULL DEFAULT '',
    MetricName TEXT NOT NULL DEFAULT '',
    MetricDescription TEXT NOT NULL DEFAULT '',
    MetricUnit TEXT NOT NULL DEFAULT '',
    Attributes TEXT NOT NULL DEFAULT '{}',
    StartTimeUnix INTEGER NOT NULL,
    TimeUnix INTEGER NOT NULL,
    Count INTEGER NOT NULL DEFAULT 0,
    Sum REAL NOT NULL DEFAULT 0,
    Scale INTEGER NOT NULL DEFAULT 0,
    ZeroCount INTEGER NOT NULL DEFAULT 0,
    PositiveOffset INTEGER NOT NULL DEFAULT 0,
    PositiveBucketCounts TEXT NOT NULL DEFAULT '[]',
    NegativeOffset INTEGER NOT NULL DEFAULT 0,
    NegativeBucketCounts TEXT NOT NULL DEFAULT '[]',
    "Exemplars.FilteredAttributes" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.TimeUnix" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.Value" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.SpanId" TEXT NOT NULL DEFAULT '[]',
    "Exemplars.TraceId" TEXT NOT NULL DEFAULT '[]',
    Min REAL,
    Max REAL,
    ZeroThreshold REAL NOT NULL DEFAULT 0,
    AggTemporality TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_otel_metrics_exp_histogram_service_metric_time ON otel_metrics_exponential_histogram (ServiceName, MetricName, TimeUnix);

-- =============================================================================
-- 8. METRICS - SUMMARY TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS otel_metrics_summary (
    ResourceAttributes TEXT NOT NULL DEFAULT '{}',
    ResourceSchemaUrl TEXT NOT NULL DEFAULT '',
    ScopeName TEXT NOT NULL DEFAULT '',
    ScopeVersion TEXT NOT NULL DEFAULT '',
    ScopeAttributes TEXT NOT NULL DEFAULT '{}',
    ScopeDroppedAttrCount INTEGER NOT NULL DEFAULT 0,
    ScopeSchemaUrl TEXT NOT NULL DEFAULT '',
    ServiceName TEXT NOT NULL DEFAULT '',
    MetricName TEXT NOT NULL DEFAULT '',
    MetricDescription TEXT NOT NULL DEFAULT '',
    MetricUnit TEXT NOT NULL DEFAULT '',
    Attributes TEXT NOT NULL DEFAULT '{}',
    StartTimeUnix INTEGER NOT NULL,
    TimeUnix INTEGER NOT NULL,
    Count INTEGER NOT NULL DEFAULT 0,
    Sum REAL NOT NULL DEFAULT 0,
    "ValueAtQuantiles.Quantile" TEXT NOT NULL DEFAULT '[]',
    "ValueAtQuantiles.Value" TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_otel_metrics_summary_service_metric_time ON otel_metrics_summary (ServiceName, MetricName, TimeUnix);
`;
