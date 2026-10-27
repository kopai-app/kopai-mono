/**
 * Golden cases for the KopaiQuery distribution and counter ops (KOP-70),
 * spec section 9.1. Each case runs against the TypeScript reference
 * (reference-ops.ts) and against real ClickHouse, so the data here is the
 * single statement of what both must return.
 *
 * Times are 2026-01-01 UTC, written "HH:MM[:SS]". The window is
 * 12:00:00–12:05:00 with `summary` output unless a case says otherwise.
 */
import type { RefInput, RefPoint, RefRow } from "./reference-ops.js";

const DAY = Date.UTC(2026, 0, 1);

/** "12:01:30" → epoch ms on 2026-01-01 UTC. */
export function t(hms: string): number {
  const [h = 0, m = 0, s = 0] = hms.split(":").map(Number);
  return DAY + ((h * 60 + m) * 60 + s) * 1000;
}

export interface GoldenCase {
  id: string;
  name: string;
  input: RefInput;
  /** Expected rows, in output order. Numbers compare to 1e-9 relative. */
  expected: RefRow[];
}

const WINDOW = { startMs: t("12:00"), endMs: t("12:05") };

/** The five keys of a HISTOGRAM_QUANTILE measure aliased `p`. */
function hq(
  value: number | null,
  low: number | null,
  high: number | null,
  coarsened: 0 | 1,
  error: string | null,
  alias = "p"
): RefRow {
  return {
    [alias]: value,
    [`${alias}_low`]: low,
    [`${alias}_high`]: high,
    [`${alias}_coarsened`]: coarsened,
    [`${alias}_error`]: error,
  };
}

function deltaHist(
  time: string,
  bounds: number[],
  buckets: number[],
  extra: Partial<RefPoint> = {}
): RefPoint {
  return {
    time: t(time),
    start: t(time) - 60_000,
    temporality: 1,
    bounds,
    buckets,
    count: buckets.reduce((a, b) => a + b, 0),
    sum: 0,
    ...extra,
  };
}

function cumHist(
  time: string,
  start: string,
  bounds: number[],
  buckets: number[],
  extra: Partial<RefPoint> = {}
): RefPoint {
  return {
    time: t(time),
    start: t(start),
    temporality: 2,
    bounds,
    buckets,
    count: buckets.reduce((a, b) => a + b, 0),
    sum: 0,
    ...extra,
  };
}

/** A Sum point; `start` is "HH:MM[:SS]" or a raw epoch-ms number (0). */
function counter(
  time: string,
  start: string | number,
  value: number,
  extra: Partial<RefPoint> = {}
): RefPoint {
  return {
    time: t(time),
    start: typeof start === "number" ? start : t(start),
    temporality: 2,
    value,
    ...extra,
  };
}

function summaryPoint(
  time: string,
  quantiles: [number, number][],
  count: number,
  extra: Partial<RefPoint> = {}
): RefPoint {
  return {
    time: t(time),
    start: t("09:00"),
    count,
    sum: 0,
    quantiles: quantiles.map(([quantile, value]) => ({ quantile, value })),
    ...extra,
  };
}

const pod = (name: string): Partial<RefPoint> => ({ resource: { pod: name } });

const HQ_P50 = [{ op: "HISTOGRAM_QUANTILE", quantile: 0.5, as: "p" }] as const;
const HQ_P95 = [{ op: "HISTOGRAM_QUANTILE", quantile: 0.95, as: "p" }] as const;
const INCREASE_VALUE = [
  { op: "INCREASE", column: "Value", as: "inc" },
] as const;

const G7_POINTS: RefPoint[] = [
  counter("11:59:30", "09:00", 1000),
  counter("12:00:30", "09:00", 1010),
  counter("12:01:30", "09:00", 1020),
  counter("12:02:30", "09:00", 1030),
  counter("12:03:30", "09:00", 1040),
  counter("12:04:30", "09:00", 1050),
];

const G9_POINTS: RefPoint[] = [
  counter("11:59:30", "09:00", 1000, pod("A")),
  counter("12:00:30", "09:00", 1010, pod("A")),
  counter("12:01:30", "09:00", 1020, pod("A")),
  counter("12:02:30", "12:02", 15, pod("A")),
  counter("12:03:30", "12:02", 25, pod("A")),
  counter("12:04:30", "12:02", 35, pod("A")),
  counter("12:03:30", "12:03", 8, pod("B")),
  counter("12:04:30", "12:03", 20, pod("B")),
  ...[7, 9, 6, 8, 10].map((v, i) =>
    counter(`12:0${i}:30`, `12:0${i}:00`, v, { ...pod("C"), temporality: 1 })
  ),
];

const G16_POINTS: RefPoint[] = [
  deltaHist("12:01", [100], [5, 5], { unit: "ms" }),
  deltaHist("12:01", [100], [5, 5], { unit: "s" }),
];

const G23_POINTS: RefPoint[] = [
  summaryPoint("12:01", [[0.95, 210]], 10, pod("A")),
  summaryPoint("12:03", [[0.95, 900]], 20, pod("A")),
  summaryPoint("12:04:30", [[0.95, 240]], 30, pod("A")),
  summaryPoint("12:01", [[0.95, 180]], 10, pod("B")),
  summaryPoint("12:03", [[0.95, 190]], 20, pod("B")),
  summaryPoint("12:04:30", [[0.95, 200]], 30, pod("B")),
];

export const GOLDEN_CASES: GoldenCase[] = [
  {
    id: "G1",
    name: "ticket example: delta buckets merged across the window",
    input: {
      metricType: "Histogram",
      window: WINDOW,
      measures: [{ op: "HISTOGRAM_QUANTILE", quantile: 0.95, as: "p" }],
      points: [
        deltaHist("12:01", [100, 250, 500, 1000], [50, 30, 15, 4, 1]),
        deltaHist("12:03", [100, 250, 500, 1000], [40, 35, 20, 4, 1]),
      ],
    },
    expected: [hq(500, 250, 500, 0, null)],
  },
  {
    id: "G2",
    name: "cumulative buckets are differenced, not summed",
    input: {
      metricType: "Histogram",
      window: WINDOW,
      measures: [...HQ_P50],
      points: [
        cumHist("12:00:30", "09:00", [250], [9000, 1000]),
        cumHist("12:04:30", "09:00", [250], [9300, 1300]),
      ],
    },
    expected: [hq(250, 0, 250, 0, null)],
  },
  {
    id: "G3",
    name: "normal restart: later plausible start time resets",
    input: {
      metricType: "Sum",
      window: WINDOW,
      measures: [...INCREASE_VALUE],
      points: [
        counter("12:00", "09:00", 100),
        counter("12:01", "09:00", 150),
        counter("12:02", "12:01:30", 20),
        counter("12:03", "12:01:30", 40),
      ],
    },
    expected: [{ inc: 90 }],
  },
  {
    id: "G4",
    name: "restart that climbs back above the old value",
    input: {
      metricType: "Sum",
      window: WINDOW,
      measures: [...INCREASE_VALUE],
      points: [
        counter("12:00", "09:00", 100),
        counter("12:01", "09:00", 110),
        counter("12:02", "12:01:10", 120),
        counter("12:03", "12:01:10", 125),
      ],
    },
    expected: [{ inc: 135 }],
  },
  {
    id: "G5",
    name: "producer that writes start = time",
    input: {
      metricType: "Sum",
      window: WINDOW,
      measures: [...INCREASE_VALUE],
      points: ["12:00", "12:01", "12:02", "12:03"].map((tm, i) =>
        counter(tm, tm, 100 + 10 * i)
      ),
    },
    expected: [{ inc: 30 }],
  },
  {
    id: "G6",
    name: "producer that writes start = 0",
    input: {
      metricType: "Sum",
      window: WINDOW,
      measures: [...INCREASE_VALUE],
      points: ["12:00", "12:01", "12:02", "12:03"].map((tm, i) =>
        counter(tm, 0, 100 + 10 * i)
      ),
    },
    expected: [{ inc: 30 }],
  },
  {
    id: "G7",
    name: "baseline from the 5-minute lookback",
    input: {
      metricType: "Sum",
      window: WINDOW,
      measures: [...INCREASE_VALUE],
      points: G7_POINTS,
    },
    expected: [{ inc: 50 }],
  },
  {
    id: "G8",
    name: "staleness marker is skipped, never a reset",
    input: {
      metricType: "Sum",
      window: WINDOW,
      measures: [...INCREASE_VALUE],
      points: [
        counter("12:00", "09:00", 1_000_000),
        counter("12:01", "09:00", 1_000_010),
        counter("12:02", "09:00", 0, { flags: 1 }),
        counter("12:03", "09:00", 1_000_020),
      ],
    },
    expected: [{ inc: 20 }],
  },
  {
    id: "G9",
    name: "three pods: lookback, restart, late start, delta",
    input: {
      metricType: "Sum",
      window: WINDOW,
      measures: [
        { op: "INCREASE", column: "Value", as: "inc" },
        { op: "RATE", column: "Value", as: "rate" },
      ],
      points: G9_POINTS,
    },
    expected: [{ inc: 115, rate: 115 / 300 }],
  },
  {
    id: "G10",
    name: "timeSeries buckets add up to the summary",
    input: {
      metricType: "Sum",
      window: WINDOW,
      granularitySec: 60,
      measures: [...INCREASE_VALUE],
      points: G9_POINTS,
    },
    expected: [17, 19, 21, 26, 32].map((inc, i) => ({
      bucket_start: t(`12:0${i}`),
      inc,
    })),
  },
  {
    id: "G11",
    name: "unaligned first bucket does not count increase from before the window",
    input: {
      metricType: "Sum",
      window: { startMs: t("12:00:30"), endMs: t("12:05:30") },
      granularitySec: 60,
      measures: [...INCREASE_VALUE],
      points: [
        counter("12:00:40", "12:00:10", 50),
        counter("12:01:40", "12:00:10", 60),
      ],
    },
    expected: [
      { bucket_start: t("12:00"), inc: 0 },
      { bucket_start: t("12:01"), inc: 10 },
    ],
  },
  {
    id: "G11s",
    name: "unaligned window, summary output",
    input: {
      metricType: "Sum",
      window: { startMs: t("12:00:30"), endMs: t("12:05:30") },
      measures: [...INCREASE_VALUE],
      points: [
        counter("12:00:40", "12:00:10", 50),
        counter("12:01:40", "12:00:10", 60),
      ],
    },
    expected: [{ inc: 10 }],
  },
  {
    id: "G12",
    name: "different layouts merge onto their shared bounds",
    input: {
      metricType: "Histogram",
      window: WINDOW,
      measures: [...HQ_P95],
      points: [
        deltaHist("12:01", [100, 500], [90, 8, 2], pod("X")),
        deltaHist("12:01", [50, 100, 250, 500], [40, 30, 20, 8, 2], pod("Y")),
      ],
    },
    expected: [hq(100 + (400 * 30) / 36, 100, 500, 1, null)],
  },
  {
    id: "G13",
    name: "layout change inside the window is a reset",
    input: {
      metricType: "Histogram",
      window: WINDOW,
      measures: [...HQ_P50],
      points: [
        cumHist("12:00:30", "09:00", [100, 500], [80, 15, 5]),
        cumHist("12:01:30", "09:00", [100, 500], [90, 18, 6]),
        cumHist("12:02:30", "09:00", [50, 100, 250, 500], [4, 3, 2, 1, 0]),
      ],
    },
    expected: [hq((100 * 12) / 17, 0, 100, 1, null)],
  },
  {
    id: "G14",
    name: "+Inf bucket returns the last finite bound",
    input: {
      metricType: "Histogram",
      window: WINDOW,
      measures: [...HQ_P95],
      points: [deltaHist("12:01", [100, 500], [10, 10, 80])],
    },
    expected: [hq(500, 500, null, 0, null)],
  },
  {
    id: "G15",
    name: "first bound at or below zero",
    input: {
      metricType: "Histogram",
      window: WINDOW,
      measures: [{ op: "HISTOGRAM_QUANTILE", quantile: 0.25, as: "p" }],
      points: [deltaHist("12:01", [0, 10], [50, 30, 20])],
    },
    expected: [hq(0, null, 0, 0, null)],
  },
  {
    id: "G16",
    name: "mixed units",
    input: {
      metricType: "Histogram",
      window: WINDOW,
      measures: [...HQ_P50],
      points: G16_POINTS,
    },
    expected: [hq(null, null, null, 0, "mixed_units")],
  },
  {
    id: "G17",
    name: "no shared bounds",
    input: {
      metricType: "Histogram",
      window: WINDOW,
      measures: [...HQ_P50],
      points: [
        deltaHist("12:01", [100, 300], [5, 5, 5], pod("X")),
        deltaHist("12:01", [50, 250], [5, 5, 5], pod("Y")),
      ],
    },
    expected: [hq(null, null, null, 1, "no_shared_bounds")],
  },
  {
    id: "G18",
    name: "no observations in the window",
    input: {
      metricType: "Histogram",
      window: WINDOW,
      measures: [...HQ_P50, { op: "INCREASE", column: "Count", as: "inc" }],
      points: [
        cumHist("12:01", "09:00", [100], [5, 5]),
        cumHist("12:02", "09:00", [100], [5, 5]),
      ],
    },
    expected: [{ ...hq(null, null, null, 0, null), inc: 0 }],
  },
  {
    id: "G19",
    name: "no finite bounds",
    input: {
      metricType: "Histogram",
      window: WINDOW,
      measures: [...HQ_P50],
      points: [deltaHist("12:01", [], [42])],
    },
    expected: [hq(null, null, null, 0, null)],
  },
  {
    id: "G20",
    name: "a single cumulative point is only a baseline",
    input: {
      metricType: "Histogram",
      window: WINDOW,
      measures: [...HQ_P50, { op: "INCREASE", column: "Count", as: "inc" }],
      points: [cumHist("12:01", "09:00", [100], [3, 1])],
    },
    expected: [{ ...hq(null, null, null, 0, null), inc: 0 }],
  },
  {
    id: "G21",
    name: "HISTOGRAM_AVG is increase of Sum over increase of Count",
    input: {
      metricType: "Histogram",
      window: WINDOW,
      measures: [{ op: "HISTOGRAM_AVG", as: "avg" }],
      points: [
        cumHist("12:01", "09:00", [1000], [100, 0], { sum: 18000 }),
        cumHist("12:02", "09:00", [1000], [101, 0], { sum: 18500 }),
      ],
    },
    expected: [{ avg: 500, avg_error: null }],
  },
  {
    id: "G22",
    name: "HISTOGRAM_AVG with mixed units",
    input: {
      metricType: "Histogram",
      window: WINDOW,
      measures: [{ op: "HISTOGRAM_AVG", as: "avg" }],
      points: [
        deltaHist("12:01", [1000], [1, 0], { unit: "ms", sum: 100 }),
        deltaHist("12:01", [1000], [1, 0], { unit: "s", sum: 1 }),
      ],
    },
    expected: [{ avg: null, avg_error: "mixed_units" }],
  },
  {
    id: "G23",
    name: "summary: latest point per series, then the max",
    input: {
      metricType: "Summary",
      window: WINDOW,
      measures: [{ op: "SUMMARY_QUANTILE", quantile: 0.95, as: "p" }],
      points: G23_POINTS,
    },
    expected: [{ p: 240 }],
  },
  {
    id: "G24",
    name: "summary: a latest point without the quantile leaves the series out",
    input: {
      metricType: "Summary",
      window: WINDOW,
      measures: [{ op: "SUMMARY_QUANTILE", quantile: 0.95, as: "p" }],
      points: [
        summaryPoint("12:01", [[0.95, 210]], 10, pod("A")),
        summaryPoint("12:04:30", [[0.5, 100]], 20, pod("A")),
        summaryPoint("12:04:30", [[0.95, 200]], 10, pod("B")),
      ],
    },
    expected: [{ p: 200 }],
  },
  {
    id: "G25",
    name: "temporality 0 points are ineligible",
    input: {
      metricType: "Sum",
      window: WINDOW,
      measures: [...INCREASE_VALUE],
      points: G7_POINTS.map((p) => ({ ...p, temporality: 0 })),
    },
    expected: [{ inc: null }],
  },
  {
    id: "G26",
    name: "HAVING keeps errored groups",
    input: {
      metricType: "Histogram",
      window: WINDOW,
      groupBy: ["service.name"],
      measures: [...HQ_P95],
      having: [{ measure: "p", op: "gt", value: 500 }],
      points: [
        deltaHist("12:01", [100, 1000], [0, 10, 0], {
          resource: { "service.name": "a" },
        }),
        ...G16_POINTS.map((p) => ({
          ...p,
          resource: { "service.name": "b" },
        })),
        deltaHist("12:01", [100], [10, 0], {
          resource: { "service.name": "c" },
        }),
      ],
    },
    expected: [
      { "service.name": "a", ...hq(955, 100, 1000, 0, null) },
      { "service.name": "b", ...hq(null, null, null, 0, "mixed_units") },
    ],
  },
  {
    id: "G27",
    name: "equal timestamps (exporter retry) give a step of 0",
    input: {
      metricType: "Sum",
      window: WINDOW,
      measures: [...INCREASE_VALUE],
      points: [
        counter("12:01", "09:00", 100),
        counter("12:01", "09:00", 100),
        counter("12:02", "09:00", 110),
      ],
    },
    expected: [{ inc: 10 }],
  },
  {
    id: "G28",
    name: "only a marker in the window",
    input: {
      metricType: "Sum",
      window: WINDOW,
      measures: [...INCREASE_VALUE, { op: "COUNT", as: "n" }],
      points: [
        counter("11:59", "09:00", 100),
        counter("12:01", "09:00", 0, { flags: 1 }),
      ],
    },
    expected: [{ inc: null, n: 1 }],
  },
  {
    id: "G29",
    name: "summary quantile next to COUNT, which still sees markers",
    input: {
      metricType: "Summary",
      window: WINDOW,
      measures: [
        { op: "SUMMARY_QUANTILE", quantile: 0.95, as: "p" },
        { op: "COUNT", as: "n" },
      ],
      points: [
        ...G23_POINTS,
        summaryPoint("12:04:45", [], 0, { ...pod("B"), flags: 1 }),
      ],
    },
    expected: [{ p: 240, n: 7 }],
  },
  {
    id: "G30",
    name: "an idle series in another unit is not mixed_units",
    input: {
      metricType: "Histogram",
      window: WINDOW,
      measures: [...HQ_P50],
      points: [
        deltaHist("12:01", [100], [10, 0], { unit: "ms" }),
        deltaHist("12:01", [100], [0, 0], { unit: "s" }),
      ],
    },
    expected: [hq(50, 0, 100, 0, null)],
  },
];
