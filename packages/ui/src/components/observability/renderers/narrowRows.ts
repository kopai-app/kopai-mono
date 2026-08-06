import type { denormalizedSignals, kopaiQuery } from "@kopai/core";

type OtelTracesRow = denormalizedSignals.OtelTracesRow;
type OtelLogsRow = denormalizedSignals.OtelLogsRow;
type OtelMetricsRow = denormalizedSignals.OtelMetricsRow;
type KopaiAggregateRow = kopaiQuery.KopaiAggregateRow;

// The polymorphic `query` dataSource method can return any of the six
// KopaiQuery result shapes. A signal-specific renderer must therefore validate
// that a response's rows match the shape it expects before forwarding them to a
// presentational component — otherwise a mismatched (e.g. wrong-signal) query
// would render garbage. `narrowRows` validates every row (not just a sample)
// and returns null when the shape doesn't match, so callers can fall back to an
// empty list and let the presentational component show its empty state.
export function narrowRows<T>(
  response: { data?: unknown } | null | undefined,
  guard: (v: unknown) => v is T
): T[] | null {
  const data = response?.data;
  if (!Array.isArray(data)) return null;
  // Accumulate through the guard so each row is narrowed to T by the type
  // predicate — no `as T[]` cast (Array.every does not narrow the array).
  const rows: T[] = [];
  for (const row of data) {
    if (!guard(row)) return null;
    rows.push(row);
  }
  return rows;
}

// The polymorphic `query` dataSource can feed a renderer any of the six
// KopaiQuery result shapes. When the rows don't match the raw shape a
// signal-specific renderer draws — most commonly an *aggregate-mode* result
// (dynamic dimension/measure keys, no `TimeUnix`/`Timestamp`), or a query for a
// different signal — `narrowRows` returns null. Silently falling back to an
// empty panel hides the misconfiguration; instead surface an explicit error so
// the dashboard author sees the mismatch.
//
// A null/absent response or an empty result set is NOT a mismatch: there is
// simply nothing to draw (the renderer's own loading/error props drive the UI),
// so those return `{ rows: [] }` with no error.
export function narrowQueryRows<T>(
  response: { data?: unknown } | null | undefined,
  guard: (v: unknown) => v is T,
  signal: "trace" | "log" | "metric"
): { rows: T[]; error?: Error } {
  const rows = narrowRows(response, guard);
  if (rows !== null) return { rows };
  // narrowRows only returns null for a non-array `data` or a present row that
  // failed the guard. A non-array (nothing fetched yet, or an upstream fetch
  // error) is not a shape mismatch; a non-empty array of wrong-shaped rows is.
  if (!Array.isArray(response?.data)) return { rows: [] };
  return {
    rows: [],
    error: new Error(
      `This panel displays raw ${signal} rows, but the query returned a different ` +
        `row shape — typically an aggregate-mode query, or a query for another signal. ` +
        `Use a raw ${signal} query, or a renderer that supports aggregate results.`
    ),
  };
}

// The inverse of the raw-row narrowers: an *aggregate* renderer accepts the
// dynamic dimension/measure rows produced by a `mode: "aggregate"` query and
// must reject a raw signal result bound to it by mistake. `narrowAggregateRows`
// returns null → an explicit error when the rows are raw-shaped, matching the
// raw renderers' behaviour so the misconfiguration is visible rather than
// silently rendering object-valued columns as JSON.
export function narrowAggregateRows(
  response: { data?: unknown } | null | undefined
): { rows: KopaiAggregateRow[]; error?: Error } {
  const rows = narrowRows(response, hasAggregateRowShape);
  if (rows !== null) return { rows };
  if (!Array.isArray(response?.data)) return { rows: [] };
  return {
    rows: [],
    error: new Error(
      `This panel displays aggregate query results, but the query returned rows ` +
        `with a raw (non-scalar) shape — typically a raw-mode query or a raw ` +
        `metric/trace/log source. Use an aggregate-mode query (mode: "aggregate").`
    ),
  };
}

// Narrows unknown to an indexable object via a type predicate, so the row
// guards below can read properties without an `as Record<...>` cast.
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// The three raw signals share structural fields (a trace-correlated log has
// SpanId + TraceId just like a span; traces and logs both have a Timestamp),
// so value-presence alone cannot tell them apart. The reliable discriminator
// is the presence of a *signal-exclusive structural key*: metric rows are the
// only ones with TimeUnix; only span rows carry SpanName/SpanKind/Duration/
// StatusCode; only log rows carry Body/SeverityText/SeverityNumber/EventName.
// Both backends' row mappers always emit these keys for their signal (the
// SELECT lists every column), so `in` checks are stable across SQLite and
// ClickHouse even when the value is empty/undefined.
const SPAN_ONLY_KEYS = ["SpanName", "SpanKind", "Duration", "StatusCode"];
const LOG_ONLY_KEYS = ["Body", "SeverityText", "SeverityNumber", "EventName"];

const hasAnyKey = (r: Record<string, unknown>, keys: string[]): boolean =>
  keys.some((k) => k in r);

export function hasMetricRowShape(v: unknown): v is OtelMetricsRow {
  if (!isRecord(v)) return false;
  // Metric data points key on TimeUnix; trace/log rows use Timestamp instead.
  // (Previously this also required `MetricType`, but that column is synthetic —
  // re-injected by each datasource after mapping — so keying on it coupled the
  // guard to an implementation detail. TimeUnix is selected directly.)
  return typeof v.TimeUnix === "string";
}

export function hasLogRowShape(v: unknown): v is OtelLogsRow {
  if (!isRecord(v)) return false;
  // Logs use Timestamp (not TimeUnix). A span row also has a Timestamp, so the
  // presence of a log-only structural key is what separates the two — SpanId/
  // TraceId are no help since a trace-correlated log carries both.
  return (
    typeof v.Timestamp === "string" &&
    typeof v.TimeUnix !== "string" &&
    hasAnyKey(v, LOG_ONLY_KEYS) &&
    !hasAnyKey(v, SPAN_ONLY_KEYS)
  );
}

export function hasTraceRowShape(v: unknown): v is OtelTracesRow {
  if (!isRecord(v)) return false;
  // Traces require a raw string Timestamp + SpanId + TraceId, but a
  // trace-correlated log carries the IDs too; the presence of a span-only
  // structural key (and no log-only key) distinguishes a real span row.
  // Requiring Timestamp also keeps aggregate rows — dynamic dimension/measure
  // keys with no raw timestamp column — from slipping through.
  return (
    typeof v.Timestamp === "string" &&
    typeof v.SpanId === "string" &&
    typeof v.TraceId === "string" &&
    typeof v.TimeUnix !== "string" &&
    hasAnyKey(v, SPAN_ONLY_KEYS) &&
    !hasAnyKey(v, LOG_ONLY_KEYS)
  );
}

// `hasMetricRowShape` keys on TimeUnix alone, which is right for raw rendering
// but too broad here: a metrics aggregate may legitimately group by TimeUnix,
// producing `{ TimeUnix, <measures> }` — a valid aggregate row that the metric
// guard would veto, routing a working query to the mismatch error. A genuine
// raw metric row always carries its value/identity columns alongside the
// timestamp (both datasources SELECT every column), so require one of those
// before treating a TimeUnix-bearing row as raw. The log and trace guards need
// no such narrowing — they already demand a raw `Timestamp` plus a
// signal-exclusive key, which no aggregate row carries.
const RAW_METRIC_COMPANION_KEYS = [
  "Value",
  "MetricName",
  "MetricType",
  "StartTimeUnix",
];

function looksRawMetric(v: Record<string, unknown>): boolean {
  return hasMetricRowShape(v) && hasAnyKey(v, RAW_METRIC_COMPANION_KEYS);
}

// Aggregate rows (KopaiAggregateRow) are flat records of scalar cells — the
// query's dimension and measure columns. Raw signal rows normally carry a
// non-scalar field (Attributes/ResourceAttributes objects, Exemplars arrays),
// but a raw row can also be all-scalar (e.g. a metric row with no attributes)
// and would then match a raw-signal guard. Reject anything the raw guards
// already claim before accepting a scalar-only record, so a raw result bound
// to an aggregate renderer surfaces the config error instead of rendering
// silently. This is safe for real aggregate rows: the raw guards require a raw
// TimeUnix/Timestamp column, which aggregate results never have (they use
// bucket_start).
export function hasAggregateRowShape(v: unknown): v is KopaiAggregateRow {
  if (!isRecord(v)) return false;
  if (looksRawMetric(v) || hasLogRowShape(v) || hasTraceRowShape(v)) {
    return false;
  }
  for (const val of Object.values(v)) {
    if (val !== null && typeof val !== "string" && typeof val !== "number") {
      return false;
    }
  }
  return true;
}
