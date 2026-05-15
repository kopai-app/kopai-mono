import type { dataFilterSchemas } from "@kopai/core";
import { nanosToDateTime64 } from "./timestamp.js";

/**
 * Escape special ILIKE pattern characters to prevent injection.
 * ClickHouse ILIKE interprets: % (any chars), _ (single char), \ (escape)
 */
function escapeLikePattern(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Build shared WHERE conditions and params used by both raw and aggregated
 * log queries. Cursor handling is intentionally excluded (aggregated path
 * never paginates).
 */
function buildLogsWhereConditions(filter: dataFilterSchemas.LogsDataFilter): {
  conditions: string[];
  params: Record<string, unknown>;
} {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  // Exact match filters
  if (filter.traceId) {
    conditions.push("TraceId = {traceId:String}");
    params.traceId = filter.traceId;
  }
  if (filter.spanId) {
    conditions.push("SpanId = {spanId:String}");
    params.spanId = filter.spanId;
  }
  if (filter.serviceName) {
    conditions.push("ServiceName = {serviceName:String}");
    params.serviceName = filter.serviceName;
  }
  if (filter.scopeName) {
    conditions.push("ScopeName = {scopeName:String}");
    params.scopeName = filter.scopeName;
  }
  if (filter.severityText) {
    conditions.push("SeverityText = {severityText:String}");
    params.severityText = filter.severityText;
  }
  if (filter.eventName) {
    conditions.push("EventName = {eventName:String}");
    params.eventName = filter.eventName;
  }

  // Severity number range
  if (filter.severityNumberMin != null) {
    conditions.push("SeverityNumber >= {sevMin:UInt8}");
    params.sevMin = filter.severityNumberMin;
  }
  if (filter.severityNumberMax != null) {
    conditions.push("SeverityNumber <= {sevMax:UInt8}");
    params.sevMax = filter.severityNumberMax;
  }

  // Body contains (ILIKE with escaped pattern)
  if (filter.bodyContains) {
    conditions.push("Body ILIKE {bodyContains:String}");
    params.bodyContains = `%${escapeLikePattern(filter.bodyContains)}%`;
  }

  // Time range
  if (filter.timestampMin != null) {
    conditions.push("Timestamp >= {tsMin:DateTime64(9)}");
    params.tsMin = nanosToDateTime64(filter.timestampMin);
  }
  if (filter.timestampMax != null) {
    conditions.push("Timestamp <= {tsMax:DateTime64(9)}");
    params.tsMax = nanosToDateTime64(filter.timestampMax);
  }

  // Attribute filters
  if (filter.logAttributes) {
    let i = 0;
    for (const [key, value] of Object.entries(filter.logAttributes)) {
      conditions.push(
        `LogAttributes[{logAttrKey${String(i)}:String}] = {logAttrVal${String(i)}:String}`
      );
      params[`logAttrKey${String(i)}`] = key;
      params[`logAttrVal${String(i)}`] = value;
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

  return { conditions, params };
}

export function buildLogsQuery(filter: dataFilterSchemas.LogsDataFilter): {
  query: string;
  params: Record<string, unknown>;
} {
  const limit = filter.limit ?? 100;
  const sortOrder = filter.sortOrder === "ASC" ? "ASC" : "DESC";

  const { conditions, params } = buildLogsWhereConditions(filter);

  // Cursor pagination with sipHash64 tiebreaker
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
        `(Timestamp < {cursorTs:DateTime64(9)} OR (Timestamp = {cursorTs:DateTime64(9)} AND sipHash64(Timestamp, Body, ServiceName, TraceId, SpanId) < {cursorHash:UInt64}))`
      );
    } else {
      conditions.push(
        `(Timestamp > {cursorTs:DateTime64(9)} OR (Timestamp = {cursorTs:DateTime64(9)} AND sipHash64(Timestamp, Body, ServiceName, TraceId, SpanId) > {cursorHash:UInt64}))`
      );
    }
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
SELECT
  Timestamp,
  TraceId,
  SpanId,
  TraceFlags,
  SeverityText,
  SeverityNumber,
  ServiceName,
  Body,
  ResourceSchemaUrl,
  ResourceAttributes,
  ScopeSchemaUrl,
  ScopeName,
  ScopeVersion,
  ScopeAttributes,
  LogAttributes,
  EventName,
  sipHash64(Timestamp, Body, ServiceName, TraceId, SpanId) AS _rowHash
FROM otel_logs
${whereClause}
ORDER BY Timestamp ${sortOrder}, _rowHash ${sortOrder}
LIMIT {limit:UInt32}`;

  params.limit = limit + 1;

  return { query, params };
}

// Server-side cap on aggregated log result rows. Per PRD §Non-Functional
// Requirements — aggregated queries return up to 1000 groups, no pagination.
const AGGREGATED_LOGS_LIMIT = 1000;

/**
 * Build an aggregated logs SQL query for COUNT-by-groupBy reporting.
 *
 * Mirrors {@link buildLogsQuery} for the WHERE clause but produces a
 * GROUP BY aggregation instead of paginated row reads. The aggregate
 * filter is currently restricted to `"count"` at the schema level.
 *
 * Cursor pagination is intentionally not supported here — the
 * {@link dataFilterSchemas.LogsDataFilter} refinement guarantees that
 * `cursor` is unset whenever `aggregate` is set.
 */
export function buildAggregatedLogsQuery(
  filter: dataFilterSchemas.LogsDataFilter
): { query: string; params: Record<string, unknown> } {
  const { conditions, params } = buildLogsWhereConditions(filter);

  // Build SELECT columns: group-by extractions + COUNT
  const selectCols: string[] = [];
  const groupByCols: string[] = [];

  if (filter.groupBy) {
    for (const [i, groupKey] of filter.groupBy.entries()) {
      const alias = `group_${String(i)}`;
      selectCols.push(
        `LogAttributes[{groupByKey${String(i)}:String}] AS ${alias}`
      );
      groupByCols.push(alias);
      params[`groupByKey${String(i)}`] = groupKey;
    }
  }

  // Only "count" is supported for logs (enforced at schema level).
  selectCols.push("COUNT(*) AS value");

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const groupByClause =
    groupByCols.length > 0 ? `GROUP BY ${groupByCols.join(", ")}` : "";

  const query = `
SELECT
  ${selectCols.join(",\n  ")}
FROM otel_logs
${whereClause}
${groupByClause}
ORDER BY value DESC
LIMIT ${String(AGGREGATED_LOGS_LIMIT)}`;

  return { query, params };
}
