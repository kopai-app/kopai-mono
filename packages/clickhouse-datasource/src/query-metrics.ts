import type { dataFilterSchemas, datasource } from "@kopai/core";
import { nanosToDateTime64 } from "./timestamp.js";

export const METRIC_TABLES = [
  { type: "Gauge", table: "otel_metrics_gauge" },
  { type: "Sum", table: "otel_metrics_sum" },
  { type: "Histogram", table: "otel_metrics_histogram" },
  { type: "ExponentialHistogram", table: "otel_metrics_exponential_histogram" },
  { type: "Summary", table: "otel_metrics_summary" },
] as const;

const TABLE_MAP: Record<datasource.MetricType, string> = Object.fromEntries(
  METRIC_TABLES.map(({ type, table }) => [type, table])
) as Record<datasource.MetricType, string>;

const COMMON_COLUMNS = [
  "ResourceAttributes",
  "ResourceSchemaUrl",
  "ScopeName",
  "ScopeVersion",
  "ScopeAttributes",
  "ScopeDroppedAttrCount",
  "ScopeSchemaUrl",
  "ServiceName",
  "MetricName",
  "MetricDescription",
  "MetricUnit",
  "Attributes",
  "StartTimeUnix",
  "TimeUnix",
];

const EXEMPLAR_COLUMNS = [
  "`Exemplars.FilteredAttributes`",
  "`Exemplars.TimeUnix`",
  "`Exemplars.Value`",
  "`Exemplars.SpanId`",
  "`Exemplars.TraceId`",
];

const TYPE_SPECIFIC_COLUMNS: Record<datasource.MetricType, string[]> = {
  Gauge: ["Value", "Flags"],
  Sum: ["Value", "Flags", "AggregationTemporality", "IsMonotonic"],
  Histogram: [
    "Count",
    "Sum",
    "BucketCounts",
    "ExplicitBounds",
    "Min",
    "Max",
    "AggregationTemporality",
  ],
  ExponentialHistogram: [
    "Count",
    "Sum",
    "Scale",
    "ZeroCount",
    "PositiveOffset",
    "PositiveBucketCounts",
    "NegativeOffset",
    "NegativeBucketCounts",
    "Min",
    "Max",
    "AggregationTemporality",
  ],
  Summary: [
    "Count",
    "Sum",
    "`ValueAtQuantiles.Quantile`",
    "`ValueAtQuantiles.Value`",
  ],
};

export function buildMetricsQuery(
  filter: dataFilterSchemas.MetricsDataFilter
): { query: string; params: Record<string, unknown> } {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};
  const limit = filter.limit ?? 100;
  const sortOrder = filter.sortOrder === "ASC" ? "ASC" : "DESC";
  const metricType: datasource.MetricType = filter.metricType;
  const table = TABLE_MAP[metricType];

  // Build column list
  const columns = [
    ...COMMON_COLUMNS,
    ...(metricType !== "Summary" ? EXEMPLAR_COLUMNS : []),
    ...TYPE_SPECIFIC_COLUMNS[metricType],
  ];

  // Exact match filters
  if (filter.metricName) {
    conditions.push("MetricName = {metricName:String}");
    params.metricName = filter.metricName;
  }
  if (filter.serviceName) {
    conditions.push("ServiceName = {serviceName:String}");
    params.serviceName = filter.serviceName;
  }
  if (filter.scopeName) {
    conditions.push("ScopeName = {scopeName:String}");
    params.scopeName = filter.scopeName;
  }

  // Time range
  if (filter.timeUnixMin != null) {
    conditions.push("TimeUnix >= {tsMin:DateTime64(9)}");
    params.tsMin = nanosToDateTime64(filter.timeUnixMin);
  }
  if (filter.timeUnixMax != null) {
    conditions.push("TimeUnix <= {tsMax:DateTime64(9)}");
    params.tsMax = nanosToDateTime64(filter.timeUnixMax);
  }

  // Attribute filters
  if (filter.attributes) {
    let i = 0;
    for (const [key, value] of Object.entries(filter.attributes)) {
      conditions.push(
        `Attributes[{attrKey${String(i)}:String}] = {attrVal${String(i)}:String}`
      );
      params[`attrKey${String(i)}`] = key;
      params[`attrVal${String(i)}`] = value;
      i++;
    }
  }
  if (filter.resourceAttributes) {
    let i = 0;
    for (const [key, value] of Object.entries(filter.resourceAttributes)) {
      conditions.push(
        `ResourceAttributes[{resAttrKey${String(i)}:String}] = {resAttrVal${String(i)}:String}`
      );
      params[`resAttrKey${String(i)}`] = key;
      params[`resAttrVal${String(i)}`] = value;
      i++;
    }
  }
  if (filter.scopeAttributes) {
    let i = 0;
    for (const [key, value] of Object.entries(filter.scopeAttributes)) {
      conditions.push(
        `ScopeAttributes[{scopeAttrKey${String(i)}:String}] = {scopeAttrVal${String(i)}:String}`
      );
      params[`scopeAttrKey${String(i)}`] = key;
      params[`scopeAttrVal${String(i)}`] = value;
      i++;
    }
  }

  // Cursor pagination with sipHash64 tiebreaker
  // Cursor format: "{nanosTimestamp}:{hash}"
  if (filter.cursor) {
    const colonIdx = filter.cursor.indexOf(":");
    if (colonIdx === -1) {
      throw new Error("Invalid cursor format: expected '{timestamp}:{hash}'");
    }
    const cursorTs = filter.cursor.slice(0, colonIdx);
    const cursorHash = filter.cursor.slice(colonIdx + 1);
    if (!/^\d+$/.test(cursorTs)) {
      throw new Error(
        `Invalid cursor timestamp: expected numeric string, got '${cursorTs}'`
      );
    }
    params.cursorTs = nanosToDateTime64(cursorTs);
    params.cursorHash = cursorHash;

    if (sortOrder === "DESC") {
      conditions.push(
        `(TimeUnix < {cursorTs:DateTime64(9)} OR (TimeUnix = {cursorTs:DateTime64(9)} AND sipHash64(TimeUnix, ServiceName, MetricName, toString(Attributes)) < {cursorHash:UInt64}))`
      );
    } else {
      conditions.push(
        `(TimeUnix > {cursorTs:DateTime64(9)} OR (TimeUnix = {cursorTs:DateTime64(9)} AND sipHash64(TimeUnix, ServiceName, MetricName, toString(Attributes)) > {cursorHash:UInt64}))`
      );
    }
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
SELECT
  ${columns.join(",\n  ")},
  sipHash64(TimeUnix, ServiceName, MetricName, toString(Attributes)) AS _rowHash
FROM ${table}
${whereClause}
ORDER BY TimeUnix ${sortOrder}, _rowHash ${sortOrder}
LIMIT {limit:UInt32}`;

  params.limit = limit + 1;

  return { query, params };
}

// ---------------------------------------------------------------------------
// Materialized-view target table names for metrics discovery.
// When these tables exist, discoverMetrics uses them for near-instant results.
// ---------------------------------------------------------------------------

export const DISCOVER_NAMES_TABLE = "otel_metrics_discover_names";
export const DISCOVER_ATTRS_TABLE = "otel_metrics_discover_attrs";

/**
 * Query to detect whether the MV target tables exist in the current database.
 * Returns rows with a `name` column for each table found.
 */
export function buildDetectDiscoverMVQuery(): string {
  return `SELECT name FROM system.tables WHERE database = currentDatabase() AND name IN ('${DISCOVER_NAMES_TABLE}', '${DISCOVER_ATTRS_TABLE}')`;
}

/**
 * Build queries that read from the MV target tables.
 */
export function buildDiscoverMetricsFromMV(): {
  namesQuery: string;
  attributesQuery: string;
} {
  const namesQuery = `
SELECT MetricName, MetricType, MetricDescription, MetricUnit
FROM ${DISCOVER_NAMES_TABLE} FINAL
ORDER BY MetricName, MetricType`;

  const attributesQuery = `
SELECT MetricName, MetricType, source, attr_key,
    groupUniqArrayMerge(101)(attr_values) AS attr_values
FROM ${DISCOVER_ATTRS_TABLE}
GROUP BY MetricName, MetricType, source, attr_key
ORDER BY MetricName, MetricType, source, attr_key`;

  return { namesQuery, attributesQuery };
}

/**
 * Build the two queries for discoverMetrics (full table scan fallback).
 */
export function buildDiscoverMetricsQueries(): {
  namesQuery: string;
  attributesQuery: string;
} {
  const metricTypes = Object.entries(TABLE_MAP).map(([type, table]) => ({
    type,
    table,
  }));

  // Query 1: Discover metric names
  const nameUnions = metricTypes
    .map(
      ({ type, table }) =>
        `SELECT MetricName, '${type}' AS MetricType, MetricDescription, MetricUnit FROM ${table}`
    )
    .join("\n    UNION ALL\n    ");

  const namesQuery = `
SELECT MetricName, MetricType, any(MetricDescription) AS MetricDescription, any(MetricUnit) AS MetricUnit
FROM (
    ${nameUnions}
)
GROUP BY MetricName, MetricType
ORDER BY MetricName, MetricType`;

  // Query 2: Discover attribute keys and values
  // Use arrayJoin(mapKeys(...)) and map access instead of untuple which doesn't
  // work with AS aliases inside UNION ALL branches.
  const attrUnions: string[] = [];
  for (const { type, table } of metricTypes) {
    attrUnions.push(
      `SELECT MetricName, '${type}' AS MetricType, 'attr' AS source,
        attr_key, Attributes[attr_key] AS attr_value
    FROM ${table}
    ARRAY JOIN mapKeys(Attributes) AS attr_key
    WHERE notEmpty(Attributes)`
    );
    attrUnions.push(
      `SELECT MetricName, '${type}', 'res_attr',
        attr_key, ResourceAttributes[attr_key] AS attr_value
    FROM ${table}
    ARRAY JOIN mapKeys(ResourceAttributes) AS attr_key
    WHERE notEmpty(ResourceAttributes)`
    );
  }

  const attributesQuery = `
SELECT MetricName, MetricType, source, attr_key, groupUniqArray(101)(attr_value) AS attr_values
FROM (
    ${attrUnions.join("\n    UNION ALL\n    ")}
)
GROUP BY MetricName, MetricType, source, attr_key
ORDER BY MetricName, MetricType, source, attr_key`;

  return { namesQuery, attributesQuery };
}
