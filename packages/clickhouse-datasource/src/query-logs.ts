import type { dataFilterSchemas } from "@kopai/core";
import { nanosToDateTime64 } from "./timestamp.js";

/** Regex for validating attribute keys */
const ATTRIBUTE_KEY_PATTERN = /^[a-zA-Z0-9._\-/]+$/;

function validateAttributeKey(key: string): void {
  if (!ATTRIBUTE_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid attribute key: ${key}`);
  }
}

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
  const sortOrder = filter.sortOrder ?? "DESC";

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
      validateAttributeKey(key);
      conditions.push(
        `LogAttributes['${key}'] = {logAttrVal${String(i)}:String}`
      );
      params[`logAttrVal${String(i)}`] = value;
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
  // Cursor format: "{nanosTimestamp}:0" — logs use timestamp-only cursor (no stable tiebreaker)
  if (filter.cursor) {
    const colonIdx = filter.cursor.indexOf(":");
    if (colonIdx === -1) {
      throw new Error("Invalid cursor format: expected '{timestamp}:{id}'");
    }
    const cursorTs = filter.cursor.slice(0, colonIdx);
    params.cursorTs = nanosToDateTime64(cursorTs);

    // For logs, cursor only uses timestamp (no stable tiebreaker)
    if (sortOrder === "DESC") {
      conditions.push("Timestamp < {cursorTs:DateTime64(9)}");
    } else {
      conditions.push("Timestamp > {cursorTs:DateTime64(9)}");
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
  LogAttributes
FROM otel_logs
${whereClause}
ORDER BY Timestamp ${sortOrder}
LIMIT {limit:UInt32}`;

  params.limit = limit + 1;

  return { query, params };
}
