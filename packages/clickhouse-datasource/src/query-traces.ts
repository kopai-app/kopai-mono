import type { dataFilterSchemas } from "@kopai/core";
import { nanosToDateTime64 } from "./timestamp.js";

/** Regex for validating attribute keys (no SQL injection via key names) */
const ATTRIBUTE_KEY_PATTERN = /^[a-zA-Z0-9._\-/]+$/;

function validateAttributeKey(key: string): void {
  if (!ATTRIBUTE_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid attribute key: ${key}`);
  }
}

export function buildTracesQuery(filter: dataFilterSchemas.TracesDataFilter): {
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
  if (filter.parentSpanId) {
    conditions.push("ParentSpanId = {parentSpanId:String}");
    params.parentSpanId = filter.parentSpanId;
  }
  if (filter.serviceName) {
    conditions.push("ServiceName = {serviceName:String}");
    params.serviceName = filter.serviceName;
  }
  if (filter.spanName) {
    conditions.push("SpanName = {spanName:String}");
    params.spanName = filter.spanName;
  }
  if (filter.spanKind) {
    conditions.push("SpanKind = {spanKind:String}");
    params.spanKind = filter.spanKind;
  }
  if (filter.statusCode) {
    conditions.push("StatusCode = {statusCode:String}");
    params.statusCode = filter.statusCode;
  }
  if (filter.scopeName) {
    conditions.push("ScopeName = {scopeName:String}");
    params.scopeName = filter.scopeName;
  }

  // Time range (nanos → DateTime64)
  if (filter.timestampMin != null) {
    conditions.push("Timestamp >= {tsMin:DateTime64(9)}");
    params.tsMin = nanosToDateTime64(filter.timestampMin);
  }
  if (filter.timestampMax != null) {
    conditions.push("Timestamp <= {tsMax:DateTime64(9)}");
    params.tsMax = nanosToDateTime64(filter.timestampMax);
  }

  // Duration range (nanos as UInt64)
  if (filter.durationMin != null) {
    conditions.push("Duration >= {durMin:UInt64}");
    params.durMin = filter.durationMin;
  }
  if (filter.durationMax != null) {
    conditions.push("Duration <= {durMax:UInt64}");
    params.durMax = filter.durationMax;
  }

  // Attribute filters — Map access
  if (filter.spanAttributes) {
    let i = 0;
    for (const [key, value] of Object.entries(filter.spanAttributes)) {
      validateAttributeKey(key);
      conditions.push(
        `SpanAttributes['${key}'] = {spanAttrVal${String(i)}:String}`
      );
      params[`spanAttrVal${String(i)}`] = value;
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
  if (filter.eventsAttributes) {
    let i = 0;
    for (const [key, value] of Object.entries(filter.eventsAttributes)) {
      validateAttributeKey(key);
      conditions.push(
        `arrayExists(x -> x['${key}'] = {evtAttrVal${String(i)}:String}, \`Events.Attributes\`)`
      );
      params[`evtAttrVal${String(i)}`] = value;
      i++;
    }
  }
  if (filter.linksAttributes) {
    let i = 0;
    for (const [key, value] of Object.entries(filter.linksAttributes)) {
      validateAttributeKey(key);
      conditions.push(
        `arrayExists(x -> x['${key}'] = {lnkAttrVal${String(i)}:String}, \`Links.Attributes\`)`
      );
      params[`lnkAttrVal${String(i)}`] = value;
      i++;
    }
  }

  // Cursor pagination with SpanId tiebreaker
  if (filter.cursor) {
    const colonIdx = filter.cursor.indexOf(":");
    if (colonIdx === -1) {
      throw new Error("Invalid cursor format: expected '{timestamp}:{id}'");
    }
    const cursorTs = filter.cursor.slice(0, colonIdx);
    const cursorSpanId = filter.cursor.slice(colonIdx + 1);

    params.cursorTs = nanosToDateTime64(cursorTs);
    params.cursorSpanId = cursorSpanId;

    if (sortOrder === "DESC") {
      conditions.push(
        `(Timestamp < {cursorTs:DateTime64(9)} OR (Timestamp = {cursorTs:DateTime64(9)} AND SpanId < {cursorSpanId:String}))`
      );
    } else {
      conditions.push(
        `(Timestamp > {cursorTs:DateTime64(9)} OR (Timestamp = {cursorTs:DateTime64(9)} AND SpanId > {cursorSpanId:String}))`
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
  ParentSpanId,
  TraceState,
  SpanName,
  SpanKind,
  ServiceName,
  ResourceAttributes,
  ScopeName,
  ScopeVersion,
  SpanAttributes,
  Duration,
  StatusCode,
  StatusMessage,
  \`Events.Timestamp\`,
  \`Events.Name\`,
  \`Events.Attributes\`,
  \`Links.TraceId\`,
  \`Links.SpanId\`,
  \`Links.TraceState\`,
  \`Links.Attributes\`
FROM otel_traces
${whereClause}
ORDER BY Timestamp ${sortOrder}, SpanId ${sortOrder}
LIMIT {limit:UInt32}`;

  params.limit = limit + 1;

  return { query, params };
}
