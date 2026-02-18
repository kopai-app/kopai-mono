import type { dataFilterSchemas, datasource } from "@kopai/core";
import { nanosToDateTime64 } from "./timestamp.js";

/** Regex for validating attribute keys */
const ATTRIBUTE_KEY_PATTERN = /^[a-zA-Z0-9._\-/]+$/;

function validateAttributeKey(key: string): void {
  if (!ATTRIBUTE_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid attribute key: ${key}`);
  }
}

const TABLE_MAP: Record<datasource.MetricType, string> = {
  Gauge: "otel_metrics_gauge",
  Sum: "otel_metrics_sum",
  Histogram: "otel_metrics_histogram",
  ExponentialHistogram: "otel_metrics_exponential_histogram",
  Summary: "otel_metrics_summary",
};

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
  Sum: ["Value", "Flags", "AggTemporality", "IsMonotonic"],
  Histogram: [
    "Count",
    "Sum",
    "BucketCounts",
    "ExplicitBounds",
    "Min",
    "Max",
    "AggTemporality",
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
    "ZeroThreshold",
    "AggTemporality",
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
      validateAttributeKey(key);
      conditions.push(`Attributes['${key}'] = {attrVal${String(i)}:String}`);
      params[`attrVal${String(i)}`] = value;
      i++;
    }
  }
  if (filter.resourceAttributes) {
    let i = 0;
    for (const [key, value] of Object.entries(filter.resourceAttributes)) {
      validateAttributeKey(key);
      conditions.push(
        `ResourceAttributes['${key}'] = {resAttrVal${String(i)}:String}`
      );
      params[`resAttrVal${String(i)}`] = value;
      i++;
    }
  }
  if (filter.scopeAttributes) {
    let i = 0;
    for (const [key, value] of Object.entries(filter.scopeAttributes)) {
      validateAttributeKey(key);
      conditions.push(
        `ScopeAttributes['${key}'] = {scopeAttrVal${String(i)}:String}`
      );
      params[`scopeAttrVal${String(i)}`] = value;
      i++;
    }
  }

  // Cursor pagination
  // Cursor format: "{nanosTimestamp}:0" — metrics use timestamp-only cursor
  if (filter.cursor) {
    const colonIdx = filter.cursor.indexOf(":");
    if (colonIdx === -1) {
      throw new Error("Invalid cursor format: expected '{timestamp}:{id}'");
    }
    const cursorTs = filter.cursor.slice(0, colonIdx);
    if (!/^\d+$/.test(cursorTs)) {
      throw new Error(
        `Invalid cursor timestamp: expected numeric string, got '${cursorTs}'`
      );
    }
    params.cursorTs = nanosToDateTime64(cursorTs);

    if (sortOrder === "DESC") {
      conditions.push("TimeUnix < {cursorTs:DateTime64(9)}");
    } else {
      conditions.push("TimeUnix > {cursorTs:DateTime64(9)}");
    }
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
SELECT
  ${columns.join(",\n  ")}
FROM ${table}
${whereClause}
ORDER BY TimeUnix ${sortOrder}
LIMIT {limit:UInt32}`;

  params.limit = limit > 0 ? limit + 1 : 0;

  return { query, params };
}

/**
 * Build the two queries for discoverMetrics.
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
