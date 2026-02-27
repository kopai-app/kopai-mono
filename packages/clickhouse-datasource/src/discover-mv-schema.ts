/**
 * DDL statements for optional materialized views that accelerate metrics discovery.
 *
 * These MVs are NOT required — the datasource falls back to full table scans
 * when they don't exist. Create them for near-instant discover on large datasets.
 *
 * Usage:
 *   1. Replace `otel_default` with your database name
 *   2. For replicated setups, replace `ReplacingMergeTree` with
 *      `ReplicatedReplacingMergeTree` and `AggregatingMergeTree` with
 *      `ReplicatedAggregatingMergeTree`
 *   3. Run target table DDLs first, then MVs
 *
 * See ADR-044 for design rationale and benchmarks.
 */

import {
  DISCOVER_NAMES_TABLE,
  DISCOVER_ATTRS_TABLE,
  METRIC_TABLES,
} from "./query-metrics.js";

const DB_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function targetTableDDL(db: string): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${db}.${DISCOVER_NAMES_TABLE}
(
    \`MetricName\` String CODEC(ZSTD(1)),
    \`MetricType\` LowCardinality(String) CODEC(ZSTD(1)),
    \`MetricDescription\` String CODEC(ZSTD(1)),
    \`MetricUnit\` String CODEC(ZSTD(1))
)
ENGINE = ReplacingMergeTree
ORDER BY (MetricName, MetricType)
SETTINGS index_granularity = 8192`,

    `CREATE TABLE IF NOT EXISTS ${db}.${DISCOVER_ATTRS_TABLE}
(
    \`MetricName\` String CODEC(ZSTD(1)),
    \`MetricType\` LowCardinality(String) CODEC(ZSTD(1)),
    \`source\` LowCardinality(String) CODEC(ZSTD(1)),
    \`attr_key\` LowCardinality(String) CODEC(ZSTD(1)),
    \`attr_values\` AggregateFunction(groupUniqArray(101), String) CODEC(ZSTD(1))
)
ENGINE = AggregatingMergeTree
ORDER BY (MetricName, MetricType, source, attr_key)
SETTINGS index_granularity = 8192`,
  ];
}

function materializedViewDDL(db: string): string[] {
  const stmts: string[] = [];

  for (const { type, table } of METRIC_TABLES) {
    // Names MV
    stmts.push(
      `CREATE MATERIALIZED VIEW IF NOT EXISTS ${db}.${DISCOVER_NAMES_TABLE}_${table.replace("otel_metrics_", "")}_mv
TO ${db}.${DISCOVER_NAMES_TABLE}
AS SELECT MetricName, '${type}' AS MetricType, MetricDescription, MetricUnit
FROM ${db}.${table}`
    );

    // Attributes MV
    stmts.push(
      `CREATE MATERIALIZED VIEW IF NOT EXISTS ${db}.${DISCOVER_ATTRS_TABLE}_${table.replace("otel_metrics_", "")}_attr_mv
TO ${db}.${DISCOVER_ATTRS_TABLE}
AS SELECT MetricName, '${type}' AS MetricType, 'attr' AS source, attr_key,
    groupUniqArrayState(101)(Attributes[attr_key]) AS attr_values
FROM ${db}.${table}
ARRAY JOIN mapKeys(Attributes) AS attr_key
WHERE notEmpty(Attributes)
GROUP BY MetricName, MetricType, source, attr_key`
    );

    // ResourceAttributes MV
    stmts.push(
      `CREATE MATERIALIZED VIEW IF NOT EXISTS ${db}.${DISCOVER_ATTRS_TABLE}_${table.replace("otel_metrics_", "")}_res_attr_mv
TO ${db}.${DISCOVER_ATTRS_TABLE}
AS SELECT MetricName, '${type}' AS MetricType, 'res_attr' AS source, attr_key,
    groupUniqArrayState(101)(ResourceAttributes[attr_key]) AS attr_values
FROM ${db}.${table}
ARRAY JOIN mapKeys(ResourceAttributes) AS attr_key
WHERE notEmpty(ResourceAttributes)
GROUP BY MetricName, MetricType, source, attr_key`
    );
  }

  return stmts;
}

/**
 * Generate all DDL statements needed to set up metrics discover MVs.
 *
 * @param database - The ClickHouse database name (e.g., "otel_default")
 * @returns Object with arrays of SQL statements for each phase
 */
export function getDiscoverMVSchema(database: string): {
  targetTables: string[];
  materializedViews: string[];
} {
  if (!DB_IDENTIFIER_RE.test(database)) {
    throw new Error(`Invalid database name: ${database}`);
  }
  return {
    targetTables: targetTableDDL(database),
    materializedViews: materializedViewDDL(database),
  };
}
