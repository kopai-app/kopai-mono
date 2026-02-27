-- Materialized views for accelerating metrics discovery.
--
-- These MVs are NOT required — the datasource falls back to full table scans
-- when they don't exist. Create them for near-instant discover on large datasets.
--
-- Usage:
--   1. Replace `otel_default` with your database name
--   2. For replicated setups, replace ReplacingMergeTree with
--      ReplicatedReplacingMergeTree and AggregatingMergeTree with
--      ReplicatedAggregatingMergeTree
--   3. Run sections in order: target tables → MVs → backfill
--
-- See ADR-044 for design rationale and benchmarks.

-- ============================================================================
-- 1. TARGET TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS otel_default.otel_metrics_discover_names
(
    `MetricName` String CODEC(ZSTD(1)),
    `MetricType` LowCardinality(String) CODEC(ZSTD(1)),
    `MetricDescription` String CODEC(ZSTD(1)),
    `MetricUnit` String CODEC(ZSTD(1))
)
ENGINE = ReplacingMergeTree
ORDER BY (MetricName, MetricType)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS otel_default.otel_metrics_discover_attrs
(
    `MetricName` String CODEC(ZSTD(1)),
    `MetricType` LowCardinality(String) CODEC(ZSTD(1)),
    `source` LowCardinality(String) CODEC(ZSTD(1)),
    `attr_key` LowCardinality(String) CODEC(ZSTD(1)),
    `attr_values` AggregateFunction(groupUniqArray(101), String) CODEC(ZSTD(1))
)
ENGINE = AggregatingMergeTree
ORDER BY (MetricName, MetricType, source, attr_key)
SETTINGS index_granularity = 8192;

-- ============================================================================
-- 2. MATERIALIZED VIEWS (one names + two attrs per metric type)
-- ============================================================================

-- Gauge -----------------------------------------------------------------

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_default.otel_metrics_discover_names_gauge_mv
TO otel_default.otel_metrics_discover_names
AS SELECT MetricName, 'Gauge' AS MetricType, MetricDescription, MetricUnit
FROM otel_default.otel_metrics_gauge;

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_default.otel_metrics_discover_attrs_gauge_attr_mv
TO otel_default.otel_metrics_discover_attrs
AS SELECT MetricName, 'Gauge' AS MetricType, 'attr' AS source, attr_key,
    groupUniqArrayState(101)(Attributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_gauge
ARRAY JOIN mapKeys(Attributes) AS attr_key
WHERE notEmpty(Attributes)
GROUP BY MetricName, MetricType, source, attr_key;

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_default.otel_metrics_discover_attrs_gauge_res_attr_mv
TO otel_default.otel_metrics_discover_attrs
AS SELECT MetricName, 'Gauge' AS MetricType, 'res_attr' AS source, attr_key,
    groupUniqArrayState(101)(ResourceAttributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_gauge
ARRAY JOIN mapKeys(ResourceAttributes) AS attr_key
WHERE notEmpty(ResourceAttributes)
GROUP BY MetricName, MetricType, source, attr_key;

-- Sum -------------------------------------------------------------------

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_default.otel_metrics_discover_names_sum_mv
TO otel_default.otel_metrics_discover_names
AS SELECT MetricName, 'Sum' AS MetricType, MetricDescription, MetricUnit
FROM otel_default.otel_metrics_sum;

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_default.otel_metrics_discover_attrs_sum_attr_mv
TO otel_default.otel_metrics_discover_attrs
AS SELECT MetricName, 'Sum' AS MetricType, 'attr' AS source, attr_key,
    groupUniqArrayState(101)(Attributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_sum
ARRAY JOIN mapKeys(Attributes) AS attr_key
WHERE notEmpty(Attributes)
GROUP BY MetricName, MetricType, source, attr_key;

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_default.otel_metrics_discover_attrs_sum_res_attr_mv
TO otel_default.otel_metrics_discover_attrs
AS SELECT MetricName, 'Sum' AS MetricType, 'res_attr' AS source, attr_key,
    groupUniqArrayState(101)(ResourceAttributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_sum
ARRAY JOIN mapKeys(ResourceAttributes) AS attr_key
WHERE notEmpty(ResourceAttributes)
GROUP BY MetricName, MetricType, source, attr_key;

-- Histogram -------------------------------------------------------------

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_default.otel_metrics_discover_names_histogram_mv
TO otel_default.otel_metrics_discover_names
AS SELECT MetricName, 'Histogram' AS MetricType, MetricDescription, MetricUnit
FROM otel_default.otel_metrics_histogram;

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_default.otel_metrics_discover_attrs_histogram_attr_mv
TO otel_default.otel_metrics_discover_attrs
AS SELECT MetricName, 'Histogram' AS MetricType, 'attr' AS source, attr_key,
    groupUniqArrayState(101)(Attributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_histogram
ARRAY JOIN mapKeys(Attributes) AS attr_key
WHERE notEmpty(Attributes)
GROUP BY MetricName, MetricType, source, attr_key;

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_default.otel_metrics_discover_attrs_histogram_res_attr_mv
TO otel_default.otel_metrics_discover_attrs
AS SELECT MetricName, 'Histogram' AS MetricType, 'res_attr' AS source, attr_key,
    groupUniqArrayState(101)(ResourceAttributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_histogram
ARRAY JOIN mapKeys(ResourceAttributes) AS attr_key
WHERE notEmpty(ResourceAttributes)
GROUP BY MetricName, MetricType, source, attr_key;

-- ExponentialHistogram ---------------------------------------------------

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_default.otel_metrics_discover_names_exponential_histogram_mv
TO otel_default.otel_metrics_discover_names
AS SELECT MetricName, 'ExponentialHistogram' AS MetricType, MetricDescription, MetricUnit
FROM otel_default.otel_metrics_exponential_histogram;

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_default.otel_metrics_discover_attrs_exponential_histogram_attr_mv
TO otel_default.otel_metrics_discover_attrs
AS SELECT MetricName, 'ExponentialHistogram' AS MetricType, 'attr' AS source, attr_key,
    groupUniqArrayState(101)(Attributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_exponential_histogram
ARRAY JOIN mapKeys(Attributes) AS attr_key
WHERE notEmpty(Attributes)
GROUP BY MetricName, MetricType, source, attr_key;

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_default.otel_metrics_discover_attrs_exponential_histogram_res_attr_mv
TO otel_default.otel_metrics_discover_attrs
AS SELECT MetricName, 'ExponentialHistogram' AS MetricType, 'res_attr' AS source, attr_key,
    groupUniqArrayState(101)(ResourceAttributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_exponential_histogram
ARRAY JOIN mapKeys(ResourceAttributes) AS attr_key
WHERE notEmpty(ResourceAttributes)
GROUP BY MetricName, MetricType, source, attr_key;

-- Summary ---------------------------------------------------------------

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_default.otel_metrics_discover_names_summary_mv
TO otel_default.otel_metrics_discover_names
AS SELECT MetricName, 'Summary' AS MetricType, MetricDescription, MetricUnit
FROM otel_default.otel_metrics_summary;

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_default.otel_metrics_discover_attrs_summary_attr_mv
TO otel_default.otel_metrics_discover_attrs
AS SELECT MetricName, 'Summary' AS MetricType, 'attr' AS source, attr_key,
    groupUniqArrayState(101)(Attributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_summary
ARRAY JOIN mapKeys(Attributes) AS attr_key
WHERE notEmpty(Attributes)
GROUP BY MetricName, MetricType, source, attr_key;

CREATE MATERIALIZED VIEW IF NOT EXISTS otel_default.otel_metrics_discover_attrs_summary_res_attr_mv
TO otel_default.otel_metrics_discover_attrs
AS SELECT MetricName, 'Summary' AS MetricType, 'res_attr' AS source, attr_key,
    groupUniqArrayState(101)(ResourceAttributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_summary
ARRAY JOIN mapKeys(ResourceAttributes) AS attr_key
WHERE notEmpty(ResourceAttributes)
GROUP BY MetricName, MetricType, source, attr_key;

-- ============================================================================
-- 3. BACKFILL (run once after creating MVs to populate from existing data)
-- ============================================================================

-- Gauge
INSERT INTO otel_default.otel_metrics_discover_names
SELECT MetricName, 'Gauge' AS MetricType, MetricDescription, MetricUnit
FROM otel_default.otel_metrics_gauge;

INSERT INTO otel_default.otel_metrics_discover_attrs
SELECT MetricName, 'Gauge' AS MetricType, 'attr' AS source, attr_key,
    groupUniqArrayState(101)(Attributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_gauge
ARRAY JOIN mapKeys(Attributes) AS attr_key
WHERE notEmpty(Attributes)
GROUP BY MetricName, MetricType, source, attr_key;

INSERT INTO otel_default.otel_metrics_discover_attrs
SELECT MetricName, 'Gauge' AS MetricType, 'res_attr' AS source, attr_key,
    groupUniqArrayState(101)(ResourceAttributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_gauge
ARRAY JOIN mapKeys(ResourceAttributes) AS attr_key
WHERE notEmpty(ResourceAttributes)
GROUP BY MetricName, MetricType, source, attr_key;

-- Sum
INSERT INTO otel_default.otel_metrics_discover_names
SELECT MetricName, 'Sum' AS MetricType, MetricDescription, MetricUnit
FROM otel_default.otel_metrics_sum;

INSERT INTO otel_default.otel_metrics_discover_attrs
SELECT MetricName, 'Sum' AS MetricType, 'attr' AS source, attr_key,
    groupUniqArrayState(101)(Attributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_sum
ARRAY JOIN mapKeys(Attributes) AS attr_key
WHERE notEmpty(Attributes)
GROUP BY MetricName, MetricType, source, attr_key;

INSERT INTO otel_default.otel_metrics_discover_attrs
SELECT MetricName, 'Sum' AS MetricType, 'res_attr' AS source, attr_key,
    groupUniqArrayState(101)(ResourceAttributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_sum
ARRAY JOIN mapKeys(ResourceAttributes) AS attr_key
WHERE notEmpty(ResourceAttributes)
GROUP BY MetricName, MetricType, source, attr_key;

-- Histogram
INSERT INTO otel_default.otel_metrics_discover_names
SELECT MetricName, 'Histogram' AS MetricType, MetricDescription, MetricUnit
FROM otel_default.otel_metrics_histogram;

INSERT INTO otel_default.otel_metrics_discover_attrs
SELECT MetricName, 'Histogram' AS MetricType, 'attr' AS source, attr_key,
    groupUniqArrayState(101)(Attributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_histogram
ARRAY JOIN mapKeys(Attributes) AS attr_key
WHERE notEmpty(Attributes)
GROUP BY MetricName, MetricType, source, attr_key;

INSERT INTO otel_default.otel_metrics_discover_attrs
SELECT MetricName, 'Histogram' AS MetricType, 'res_attr' AS source, attr_key,
    groupUniqArrayState(101)(ResourceAttributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_histogram
ARRAY JOIN mapKeys(ResourceAttributes) AS attr_key
WHERE notEmpty(ResourceAttributes)
GROUP BY MetricName, MetricType, source, attr_key;

-- ExponentialHistogram
INSERT INTO otel_default.otel_metrics_discover_names
SELECT MetricName, 'ExponentialHistogram' AS MetricType, MetricDescription, MetricUnit
FROM otel_default.otel_metrics_exponential_histogram;

INSERT INTO otel_default.otel_metrics_discover_attrs
SELECT MetricName, 'ExponentialHistogram' AS MetricType, 'attr' AS source, attr_key,
    groupUniqArrayState(101)(Attributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_exponential_histogram
ARRAY JOIN mapKeys(Attributes) AS attr_key
WHERE notEmpty(Attributes)
GROUP BY MetricName, MetricType, source, attr_key;

INSERT INTO otel_default.otel_metrics_discover_attrs
SELECT MetricName, 'ExponentialHistogram' AS MetricType, 'res_attr' AS source, attr_key,
    groupUniqArrayState(101)(ResourceAttributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_exponential_histogram
ARRAY JOIN mapKeys(ResourceAttributes) AS attr_key
WHERE notEmpty(ResourceAttributes)
GROUP BY MetricName, MetricType, source, attr_key;

-- Summary
INSERT INTO otel_default.otel_metrics_discover_names
SELECT MetricName, 'Summary' AS MetricType, MetricDescription, MetricUnit
FROM otel_default.otel_metrics_summary;

INSERT INTO otel_default.otel_metrics_discover_attrs
SELECT MetricName, 'Summary' AS MetricType, 'attr' AS source, attr_key,
    groupUniqArrayState(101)(Attributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_summary
ARRAY JOIN mapKeys(Attributes) AS attr_key
WHERE notEmpty(Attributes)
GROUP BY MetricName, MetricType, source, attr_key;

INSERT INTO otel_default.otel_metrics_discover_attrs
SELECT MetricName, 'Summary' AS MetricType, 'res_attr' AS source, attr_key,
    groupUniqArrayState(101)(ResourceAttributes[attr_key]) AS attr_values
FROM otel_default.otel_metrics_summary
ARRAY JOIN mapKeys(ResourceAttributes) AS attr_key
WHERE notEmpty(ResourceAttributes)
GROUP BY MetricName, MetricType, source, attr_key;

-- ============================================================================
-- 4. CLEANUP (drop MVs first, then target tables)
-- ============================================================================

-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_names_gauge_mv;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_attrs_gauge_attr_mv;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_attrs_gauge_res_attr_mv;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_names_sum_mv;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_attrs_sum_attr_mv;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_attrs_sum_res_attr_mv;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_names_histogram_mv;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_attrs_histogram_attr_mv;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_attrs_histogram_res_attr_mv;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_names_exponential_histogram_mv;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_attrs_exponential_histogram_attr_mv;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_attrs_exponential_histogram_res_attr_mv;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_names_summary_mv;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_attrs_summary_attr_mv;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_attrs_summary_res_attr_mv;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_names;
-- DROP TABLE IF EXISTS otel_default.otel_metrics_discover_attrs;
