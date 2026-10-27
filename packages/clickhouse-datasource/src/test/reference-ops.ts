/**
 * Test-only reference implementation of the KopaiQuery distribution and
 * counter ops (KOP-70, spec section 4). Plain TypeScript over arrays of
 * points, written to read like the spec rather than to be fast: it is the
 * oracle the ClickHouse compiler is checked against (golden cases and the
 * differential tests), so every rule here maps to a sentence in section 4.
 */

export type RefMetricType = "Sum" | "Histogram" | "Summary";

/** One stored data point, in the shape of a row of the metric's table. */
export interface RefPoint {
  metricName?: string;
  unit?: string;
  scopeName?: string;
  scopeVersion?: string;
  resource?: Record<string, string>;
  attributes?: Record<string, string>;
  /** TimeUnix, epoch ms. */
  time: number;
  /** StartTimeUnix, epoch ms (0 when the producer leaves it unset). */
  start: number;
  /** AggregationTemporality. Absent on Summary, which has no such column. */
  temporality?: number;
  flags?: number;
  /** Sum. */
  value?: number;
  /** Histogram and Summary. */
  count?: number;
  sum?: number;
  /** Histogram. */
  bounds?: number[];
  buckets?: number[];
  /** Summary. */
  quantiles?: { quantile: number; value: number }[];
}

export type RefMeasure =
  | { op: "HISTOGRAM_QUANTILE"; quantile: number; as: string }
  | { op: "HISTOGRAM_AVG"; as: string }
  | { op: "SUMMARY_QUANTILE"; quantile: number; as: string }
  | { op: "INCREASE" | "RATE"; column: "Value" | "Count" | "Sum"; as: string }
  | { op: "COUNT"; as: string };

export interface RefHaving {
  measure: string;
  op: "gt" | "gte" | "lt" | "lte" | "eq";
  value: number;
}

export interface RefInput {
  metricType: RefMetricType;
  /** `[startMs, endMs)` from timeDimension. */
  window: { startMs: number; endMs: number };
  /** Set for `timeSeries` output; absent means `summary`. */
  granularitySec?: number;
  /** Resource attribute keys to group by; a missing key groups as "". */
  groupBy?: string[];
  measures: RefMeasure[];
  having?: RefHaving[];
  points: RefPoint[];
}

export type RefRow = Record<string, number | string | null>;

/** Section 4.1: rows before the window only serve as previous points. */
export const LOOKBACK_MS = 300_000;

const QUANTILE_EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// 4.1 Series and eligible points

function seriesKey(p: RefPoint): string {
  return JSON.stringify([
    p.metricName ?? "",
    p.unit ?? "",
    p.scopeName ?? "",
    p.scopeVersion ?? "",
    sortedEntries(p.resource),
    sortedEntries(p.attributes),
  ]);
}

function sortedEntries(m: Record<string, string> | undefined) {
  return Object.entries(m ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
}

function isEligible(p: RefPoint, type: RefMetricType): boolean {
  if (((p.flags ?? 0) & 1) !== 0) return false; // staleness marker
  if (type === "Summary") return true; // no AggregationTemporality column
  return p.temporality === 1 || p.temporality === 2;
}

/** The type's order value: Value for Sum, Count for Histogram and Summary. */
function orderValue(p: RefPoint, type: RefMetricType): number {
  return (type === "Sum" ? p.value : p.count) ?? 0;
}

function comparePoints(type: RefMetricType) {
  return (a: RefPoint, b: RefPoint) =>
    a.time - b.time ||
    a.start - b.start ||
    orderValue(a, type) - orderValue(b, type);
}

// ---------------------------------------------------------------------------
// 4.2 Steps

/** What a point contributes, for every column the ops can read. */
interface Step {
  value: number;
  count: number;
  sum: number;
  bounds: number[];
  buckets: number[];
}

function pointAsStep(p: RefPoint): Step {
  return {
    value: p.value ?? 0,
    count: p.count ?? 0,
    sum: p.sum ?? 0,
    bounds: p.bounds ?? [],
    buckets: p.buckets ?? [],
  };
}

function zeroStep(p: RefPoint): Step {
  return {
    value: 0,
    count: 0,
    sum: 0,
    bounds: p.bounds ?? [],
    buckets: (p.buckets ?? []).map(() => 0),
  };
}

function plausibleStart(x: RefPoint): boolean {
  return 0 < x.start && x.start < x.time;
}

function sameBounds(a: number[] | undefined, b: number[] | undefined) {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Section 4.4 step 0: bucket counts that do not fit the bounds. A point with
 * no counts at all (count and sum only) is not malformed.
 */
function malformed(p: RefPoint): boolean {
  const n = (p.buckets ?? []).length;
  return n > 0 && n !== (p.bounds ?? []).length + 1;
}

function step(
  c: RefPoint,
  p: RefPoint | undefined,
  type: RefMetricType,
  windowStart: number
): Step {
  if (c.temporality === 1) return pointAsStep(c);

  if (!p) {
    return plausibleStart(c) && c.start >= windowStart
      ? pointAsStep(c)
      : zeroStep(c);
  }

  let valueDrop: boolean;
  let layoutChange = false;
  if (type === "Sum") {
    valueDrop = (c.value ?? 0) < (p.value ?? 0);
  } else {
    layoutChange = !sameBounds(c.bounds, p.bounds);
    const cb = c.buckets ?? [];
    const pb = p.buckets ?? [];
    // Counts compare bucket by bucket only when both points have as many.
    valueDrop =
      (c.count ?? 0) < (p.count ?? 0) ||
      (!layoutChange &&
        cb.length === pb.length &&
        cb.some((v, i) => v < pb[i]!));
  }
  const reset =
    valueDrop || layoutChange || (c.start > p.start && plausibleStart(c));
  if (reset) return pointAsStep(c);

  const cb = c.buckets ?? [];
  const pb = p.buckets ?? [];
  return {
    value: (c.value ?? 0) - (p.value ?? 0),
    count: (c.count ?? 0) - (p.count ?? 0),
    sum: (c.sum ?? 0) - (p.sum ?? 0),
    bounds: c.bounds ?? [],
    buckets: cb.length === pb.length ? cb.map((v, i) => v - pb[i]!) : cb,
  };
}

// ---------------------------------------------------------------------------
// Grouping

interface Contribution {
  series: string;
  unit: string;
  point: RefPoint;
  /** Undefined for points that are not eligible. */
  step: Step | undefined;
  /** Histogram: the point or its previous point has malformed buckets. */
  malformed: boolean;
}

interface Cell {
  groupValues: string[];
  bucketStart: number;
  contributions: Contribution[];
}

function bucketOf(time: number, input: RefInput): number {
  if (input.granularitySec === undefined) return input.window.startMs;
  const g = input.granularitySec * 1000;
  return Math.floor(time / g) * g; // aligned to the epoch
}

function buildCells(input: RefInput): Cell[] {
  const { window, metricType: type } = input;
  const scanned = input.points.filter(
    (p) => p.time >= window.startMs - LOOKBACK_MS && p.time < window.endMs
  );

  // Previous eligible point of the same series and the same temporality.
  const stepOf = new Map<RefPoint, Step>();
  const malformedOf = new Set<RefPoint>();
  const walks = new Map<string, RefPoint[]>();
  for (const p of scanned) {
    if (!isEligible(p, type)) continue;
    const k = `${seriesKey(p)}|${p.temporality ?? ""}`;
    let list = walks.get(k);
    if (!list) walks.set(k, (list = []));
    list.push(p);
  }
  for (const list of walks.values()) {
    list.sort(comparePoints(type));
    list.forEach((c, i) => {
      if (c.time < window.startMs) return;
      const prev = list[i - 1];
      stepOf.set(c, step(c, prev, type, window.startMs));
      if (type === "Histogram" && (malformed(c) || (prev && malformed(prev)))) {
        malformedOf.add(c);
      }
    });
  }

  const cells = new Map<string, Cell>();
  for (const p of scanned) {
    if (p.time < window.startMs) continue;
    const groupValues = (input.groupBy ?? []).map((k) => p.resource?.[k] ?? "");
    const bucketStart = bucketOf(p.time, input);
    const k = JSON.stringify([groupValues, bucketStart]);
    let cell = cells.get(k);
    if (!cell) {
      cells.set(k, (cell = { groupValues, bucketStart, contributions: [] }));
    }
    cell.contributions.push({
      series: seriesKey(p),
      unit: p.unit ?? "",
      point: p,
      step: stepOf.get(p),
      malformed: malformedOf.has(p),
    });
  }

  // A summary with no dimensions is one group whether or not it has rows, as
  // an ungrouped SQL aggregate is (COUNT 0, the new ops NULL).
  const ungrouped =
    (input.groupBy ?? []).length === 0 && input.granularitySec === undefined;
  if (ungrouped && cells.size === 0) {
    return [
      { groupValues: [], bucketStart: window.startMs, contributions: [] },
    ];
  }

  return [...cells.values()].sort(
    (a, b) =>
      compareStrings(a.groupValues, b.groupValues) ||
      a.bucketStart - b.bucketStart
  );
}

function compareStrings(a: string[], b: string[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
  }
  return 0;
}

function eligible(cell: Cell) {
  return cell.contributions.filter(
    (c): c is Contribution & { step: Step } => c.step !== undefined
  );
}

// ---------------------------------------------------------------------------
// 4.3 Counter ops

function increase(cell: Cell, column: "Value" | "Count" | "Sum") {
  const steps = eligible(cell);
  if (steps.length === 0) return null;
  const field =
    column === "Value" ? "value" : column === "Count" ? "count" : "sum";
  return steps.reduce((acc, c) => acc + c.step[field], 0);
}

// ---------------------------------------------------------------------------
// 4.4 Histogram quantile

interface Vector {
  bounds: number[];
  counts: number[];
  unit: string;
}

/** Step 1: per series, sum step vectors per layout; drop empty or all-zero. */
function seriesVectors(cell: Cell): Vector[] {
  const bySeriesLayout = new Map<string, Vector>();
  for (const c of eligible(cell)) {
    const k = JSON.stringify([c.series, c.step.bounds]);
    const v = bySeriesLayout.get(k);
    if (!v) {
      bySeriesLayout.set(k, {
        bounds: c.step.bounds,
        counts: [...c.step.buckets],
        unit: c.unit,
      });
    } else {
      c.step.buckets.forEach((n, i) => (v.counts[i] = (v.counts[i] ?? 0) + n));
    }
  }
  return [...bySeriesLayout.values()].filter((v) =>
    v.counts.some((n) => n !== 0)
  );
}

function cumsum(xs: number[]): number[] {
  let acc = 0;
  return xs.map((x) => (acc += x));
}

function coarsen(v: Vector, shared: number[]): number[] {
  const r = cumsum(v.counts);
  const atShared = shared.map((s) => r[v.bounds.indexOf(s)]!);
  const totals = [...atShared, r[r.length - 1]!];
  return totals.map((x, i) => x - (i === 0 ? 0 : totals[i - 1]!));
}

function histogramQuantile(cell: Cell, q: number) {
  const empty = {
    value: null,
    low: null,
    high: null,
    coarsened: 0,
    error: null,
  };
  if (eligible(cell).some((c) => c.malformed)) {
    return { ...empty, error: "malformed_buckets" };
  }
  const vectors = seriesVectors(cell);
  if (vectors.length === 0) return empty;
  if (new Set(vectors.map((v) => v.unit)).size > 1) {
    return { ...empty, error: "mixed_units" };
  }
  if (vectors.every((v) => v.bounds.length === 0)) return empty;

  const layouts = new Set(vectors.map((v) => JSON.stringify(v.bounds)));
  const coarsened = layouts.size > 1 ? 1 : 0;
  const shared = vectors[0]!.bounds.filter((s) =>
    vectors.every((v) => v.bounds.includes(s))
  );
  if (shared.length === 0) {
    return { ...empty, coarsened: 1, error: "no_shared_bounds" };
  }

  const merged = new Array<number>(shared.length + 1).fill(0);
  for (const v of vectors) {
    coarsen(v, shared).forEach((n, i) => (merged[i]! += n));
  }
  const rm = cumsum(merged);
  const total = rm[rm.length - 1]!;
  const target = q * total;
  const i = rm.findIndex((x) => x >= target);

  const base = { coarsened, error: null };
  if (i === shared.length) {
    const last = shared[shared.length - 1]!;
    return { ...base, value: last, low: last, high: null };
  }
  if (i === 0) {
    const s0 = shared[0]!;
    return s0 > 0
      ? { ...base, value: (s0 * target) / merged[0]!, low: 0, high: s0 }
      : { ...base, value: s0, low: null, high: s0 };
  }
  const lo = shared[i - 1]!;
  const hi = shared[i]!;
  return {
    ...base,
    value: lo + ((hi - lo) * (target - rm[i - 1]!)) / merged[i]!,
    low: lo,
    high: hi,
  };
}

// ---------------------------------------------------------------------------
// 4.5 HISTOGRAM_AVG

function histogramAvg(cell: Cell) {
  const steps = eligible(cell);
  const countBySeries = new Map<string, { unit: string; count: number }>();
  let sum = 0;
  let count = 0;
  for (const c of steps) {
    sum += c.step.sum;
    count += c.step.count;
    const s = countBySeries.get(c.series) ?? { unit: c.unit, count: 0 };
    s.count += c.step.count;
    countBySeries.set(c.series, s);
  }
  const units = new Set(
    [...countBySeries.values()].filter((s) => s.count !== 0).map((s) => s.unit)
  );
  if (units.size > 1) return { value: null, error: "mixed_units" };
  return { value: count === 0 ? null : sum / count, error: null };
}

// ---------------------------------------------------------------------------
// 4.6 SUMMARY_QUANTILE

function summaryQuantile(cell: Cell, q: number, type: RefMetricType) {
  const latest = new Map<string, RefPoint>();
  for (const c of eligible(cell)) {
    const prev = latest.get(c.series);
    if (!prev || comparePoints(type)(prev, c.point) <= 0) {
      latest.set(c.series, c.point);
    }
  }
  let best: number | null = null;
  for (const p of latest.values()) {
    const hit = (p.quantiles ?? []).find(
      (x) => Math.abs(x.quantile - q) < QUANTILE_EPSILON
    );
    if (hit && (best === null || hit.value > best)) best = hit.value;
  }
  return best;
}

// ---------------------------------------------------------------------------
// 4.7 Having

function passesHaving(row: RefRow, h: RefHaving, histogramAlias: boolean) {
  if (histogramAlias && row[`${h.measure}_error`] !== null) return true;
  const v = row[h.measure];
  if (typeof v !== "number") return false;
  switch (h.op) {
    case "gt":
      return v > h.value;
    case "gte":
      return v >= h.value;
    case "lt":
      return v < h.value;
    case "lte":
      return v <= h.value;
    case "eq":
      return v === h.value;
  }
}

// ---------------------------------------------------------------------------

export function referenceAggregate(input: RefInput): RefRow[] {
  const seconds =
    input.granularitySec ?? (input.window.endMs - input.window.startMs) / 1000;
  const histogramAliases = new Set(
    input.measures
      .filter((m) => m.op === "HISTOGRAM_QUANTILE" || m.op === "HISTOGRAM_AVG")
      .map((m) => m.as)
  );

  const rows: RefRow[] = [];
  for (const cell of buildCells(input)) {
    const row: RefRow = {};
    (input.groupBy ?? []).forEach((k, i) => (row[k] = cell.groupValues[i]!));
    if (input.granularitySec !== undefined) row.bucket_start = cell.bucketStart;

    for (const m of input.measures) {
      switch (m.op) {
        case "COUNT":
          row[m.as] = cell.contributions.length;
          break;
        case "INCREASE":
          row[m.as] = increase(cell, m.column);
          break;
        case "RATE": {
          const inc = increase(cell, m.column);
          row[m.as] = inc === null ? null : inc / seconds;
          break;
        }
        case "HISTOGRAM_QUANTILE": {
          const r = histogramQuantile(cell, m.quantile);
          row[m.as] = r.value;
          row[`${m.as}_low`] = r.low;
          row[`${m.as}_high`] = r.high;
          row[`${m.as}_coarsened`] = r.coarsened;
          row[`${m.as}_error`] = r.error;
          break;
        }
        case "HISTOGRAM_AVG": {
          const r = histogramAvg(cell);
          row[m.as] = r.value;
          row[`${m.as}_error`] = r.error;
          break;
        }
        case "SUMMARY_QUANTILE":
          row[m.as] = summaryQuantile(cell, m.quantile, input.metricType);
          break;
      }
    }

    const keep = (input.having ?? []).every((h) =>
      passesHaving(row, h, histogramAliases.has(h.measure))
    );
    if (keep) rows.push(row);
  }
  return rows;
}
