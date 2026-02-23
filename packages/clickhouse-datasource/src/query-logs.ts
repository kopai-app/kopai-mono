import type { dataFilterSchemas } from "@kopai/core";
import { nanosToDateTime64 } from "./timestamp.js";

/**
 * Escape special ILIKE pattern characters to prevent injection.
 * ClickHouse ILIKE interprets: % (any chars), _ (single char), \ (escape)
 */
function escapeLikePattern(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function buildLogsQuery(filter: dataFilterSchemas.LogsDataFilter): {
  query: string;
  params: Record<string, unknown>;
} {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};
  const limit = filter.limit ?? 100;
  const sortOrder = filter.sortOrder === "ASC" ? "ASC" : "DESC";

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
  sipHash64(Timestamp, Body, ServiceName, TraceId, SpanId) AS _rowHash
FROM otel_logs
${whereClause}
ORDER BY Timestamp ${sortOrder}, _rowHash ${sortOrder}
LIMIT {limit:UInt32}`;

  params.limit = limit + 1;

  return { query, params };
}
