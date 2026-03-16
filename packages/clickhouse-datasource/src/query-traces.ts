import type { dataFilterSchemas } from "@kopai/core";
import { nanosToDateTime64 } from "./timestamp.js";

/** Default lookback for services/operations discovery (7 days in ms). */
const DISCOVERY_LOOKBACK_MS = 7 * 24 * 60 * 60_000;

export function buildServicesQuery(): {
  query: string;
  params: Record<string, unknown>;
} {
  const tsMin = String((Date.now() - DISCOVERY_LOOKBACK_MS) * 1e6);
  return {
    query: `SELECT DISTINCT ServiceName FROM otel_traces WHERE Timestamp >= {tsMin:DateTime64(9)} ORDER BY ServiceName`,
    params: { tsMin: nanosToDateTime64(tsMin) },
  };
}

export function buildOperationsQuery(filter: { serviceName: string }): {
  query: string;
  params: Record<string, unknown>;
} {
  const tsMin = String((Date.now() - DISCOVERY_LOOKBACK_MS) * 1e6);
  return {
    query: `SELECT DISTINCT SpanName FROM otel_traces WHERE ServiceName = {serviceName:String} AND Timestamp >= {tsMin:DateTime64(9)} ORDER BY SpanName`,
    params: {
      serviceName: filter.serviceName,
      tsMin: nanosToDateTime64(tsMin),
    },
  };
}

export function buildTraceSummariesQuery(
  filter: dataFilterSchemas.TraceSummariesFilter
): {
  query: string;
  params: Record<string, unknown>;
} {
  const outerConditions: string[] = [];
  const spanConditions: string[] = [];
  const havingConditions: string[] = [];
  const params: Record<string, unknown> = {};
  const limit = filter.limit ?? 20;
  const sortOrder = filter.sortOrder === "ASC" ? "ASC" : "DESC";

  // Span-level filters — used in subquery to find matching TraceIds
  if (filter.serviceName) {
    spanConditions.push("ServiceName = {serviceName:String}");
    params.serviceName = filter.serviceName;
  }
  if (filter.spanName) {
    spanConditions.push("SpanName = {spanName:String}");
    params.spanName = filter.spanName;
  }
  if (filter.spanAttributes) {
    let i = 0;
    for (const [key, value] of Object.entries(filter.spanAttributes)) {
      spanConditions.push(
        `SpanAttributes[{spanAttrKey${String(i)}:String}] = {spanAttrVal${String(i)}:String}`
      );
      params[`spanAttrKey${String(i)}`] = key;
      params[`spanAttrVal${String(i)}`] = value;
      i++;
    }
  }
  if (filter.resourceAttributes) {
    let i = 0;
    for (const [key, value] of Object.entries(filter.resourceAttributes)) {
      spanConditions.push(
        `ResourceAttributes[{resAttrKey${String(i)}:String}] = {resAttrVal${String(i)}:String}`
      );
      params[`resAttrKey${String(i)}`] = key;
      params[`resAttrVal${String(i)}`] = value;
      i++;
    }
  }

  // Time range — applied to both outer query and span subquery
  if (filter.timestampMin != null) {
    outerConditions.push("Timestamp >= {tsMin:DateTime64(9)}");
    spanConditions.push("Timestamp >= {tsMin:DateTime64(9)}");
    params.tsMin = nanosToDateTime64(filter.timestampMin);
  }
  if (filter.timestampMax != null) {
    outerConditions.push("Timestamp <= {tsMax:DateTime64(9)}");
    spanConditions.push("Timestamp <= {tsMax:DateTime64(9)}");
    params.tsMax = nanosToDateTime64(filter.timestampMax);
  }

  // Restrict to matching TraceIds when span-level filters are present
  if (spanConditions.length > 0) {
    outerConditions.push(
      `TraceId IN (SELECT DISTINCT TraceId FROM otel_traces WHERE ${spanConditions.join(" AND ")})`
    );
  }

  // Duration filters — trace-level, applied as HAVING on aggregated duration
  if (filter.durationMin != null) {
    havingConditions.push(
      "dateDiff('nanosecond', min(Timestamp), max(Timestamp + toIntervalNanosecond(Duration))) >= {durMin:UInt64}"
    );
    params.durMin = filter.durationMin;
  }
  if (filter.durationMax != null) {
    havingConditions.push(
      "dateDiff('nanosecond', min(Timestamp), max(Timestamp + toIntervalNanosecond(Duration))) <= {durMax:UInt64}"
    );
    params.durMax = filter.durationMax;
  }

  // Cursor pagination on (startTimeNs, TraceId) — applied as HAVING since startTimeNs is aggregate
  if (filter.cursor) {
    const colonIdx = filter.cursor.indexOf(":");
    if (colonIdx === -1) {
      throw new Error("Invalid cursor format: expected '{timestamp}:{id}'");
    }
    const cursorTs = filter.cursor.slice(0, colonIdx);
    const cursorTraceId = filter.cursor.slice(colonIdx + 1);
    if (!/^\d+$/.test(cursorTs)) {
      throw new Error(
        `Invalid cursor timestamp: expected numeric string, got '${cursorTs}'`
      );
    }

    params.cursorTs = nanosToDateTime64(cursorTs);
    params.cursorTraceId = cursorTraceId;

    if (sortOrder === "DESC") {
      havingConditions.push(
        `(_startTime < {cursorTs:DateTime64(9)} OR (_startTime = {cursorTs:DateTime64(9)} AND TraceId < {cursorTraceId:String}))`
      );
    } else {
      havingConditions.push(
        `(_startTime > {cursorTs:DateTime64(9)} OR (_startTime = {cursorTs:DateTime64(9)} AND TraceId > {cursorTraceId:String}))`
      );
    }
  }

  const whereClause =
    outerConditions.length > 0 ? `WHERE ${outerConditions.join(" AND ")}` : "";
  const havingClause =
    havingConditions.length > 0
      ? `HAVING ${havingConditions.join(" AND ")}`
      : "";

  const query = `
SELECT
  TraceId,
  if(anyIf(ServiceName, ParentSpanId = '') != '', anyIf(ServiceName, ParentSpanId = ''), any(ServiceName)) as rootServiceName,
  if(anyIf(SpanName, ParentSpanId = '') != '', anyIf(SpanName, ParentSpanId = ''), any(SpanName)) as rootSpanName,
  min(Timestamp) as _startTime,
  toString(toUnixTimestamp64Nano(min(Timestamp))) as startTimeNs,
  toString(dateDiff('nanosecond', min(Timestamp), max(Timestamp + toIntervalNanosecond(Duration)))) as durationNs,
  toUInt32(count()) as spanCount,
  toUInt32(countIf(StatusCode = 'ERROR')) as errorCount,
  groupArray(tuple(ServiceName, StatusCode)) as _serviceData
FROM otel_traces
${whereClause}
GROUP BY TraceId
${havingClause}
ORDER BY _startTime ${sortOrder}, TraceId ${sortOrder}
LIMIT {limit:UInt32}`;

  params.limit = limit + 1;

  return { query, params };
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
      conditions.push(
        `SpanAttributes[{spanAttrKey${String(i)}:String}] = {spanAttrVal${String(i)}:String}`
      );
      params[`spanAttrKey${String(i)}`] = key;
      params[`spanAttrVal${String(i)}`] = value;
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
  if (filter.eventsAttributes) {
    let i = 0;
    for (const [key, value] of Object.entries(filter.eventsAttributes)) {
      conditions.push(
        `arrayExists(x -> x[{evtAttrKey${String(i)}:String}] = {evtAttrVal${String(i)}:String}, \`Events.Attributes\`)`
      );
      params[`evtAttrKey${String(i)}`] = key;
      params[`evtAttrVal${String(i)}`] = value;
      i++;
    }
  }
  if (filter.linksAttributes) {
    let i = 0;
    for (const [key, value] of Object.entries(filter.linksAttributes)) {
      conditions.push(
        `arrayExists(x -> x[{lnkAttrKey${String(i)}:String}] = {lnkAttrVal${String(i)}:String}, \`Links.Attributes\`)`
      );
      params[`lnkAttrKey${String(i)}`] = key;
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
    if (!/^\d+$/.test(cursorTs)) {
      throw new Error(
        `Invalid cursor timestamp: expected numeric string, got '${cursorTs}'`
      );
    }

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
