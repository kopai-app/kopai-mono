/**
 * Seeded scenario generator for the differential tests (spec 9, layer 3).
 * Each scenario mixes the situations the per-series walk must get right:
 * delta, cumulative and temporality-0 series, restarts with and without a
 * later start time, `start = time` and `start = 0` producers, staleness
 * markers, exporter retries, histogram layout changes, gaps around the
 * 5-minute lookback, unaligned windows, and summary and timeSeries output.
 *
 * No dependency: a small PRNG (mulberry32), so a failing seed replays.
 */
import type { RefInput, RefMeasure, RefPoint } from "./reference-ops.js";

export interface Scenario {
  seed: number;
  input: RefInput;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE = Date.UTC(2026, 0, 1, 12, 0, 0);
const LAYOUTS = [[100, 250, 500, 1000], [100, 500], [50, 100, 250, 500], []];

export function generateScenario(seed: number): Scenario {
  const rand = mulberry32(seed);
  const int = (lo: number, hi: number) =>
    lo + Math.floor(rand() * (hi - lo + 1));
  const chance = (p: number) => rand() < p;
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;

  const r = rand();
  const metricType = r < 0.45 ? "Sum" : r < 0.85 ? "Histogram" : "Summary";
  // Unaligned window start; lengths short enough that gaps cross the lookback.
  const startMs = BASE + int(0, 89) * 1000;
  const lengthSec = pick([120, 300, 600]);
  const window = { startMs, endMs: startMs + lengthSec * 1000 };
  const granularitySec = chance(0.5) ? pick([30, 60, 120]) : undefined;
  const grouped = chance(0.4);

  const points: RefPoint[] = [];
  const seriesCount = int(1, 4);
  for (let s = 0; s < seriesCount; s++) {
    const resource = { pod: `pod-${String(s)}`, grp: `g${String(s % 2)}` };
    const unit = chance(0.1) ? "s" : "ms";
    const tr = rand();
    let temporality = tr < 0.6 ? 2 : tr < 0.95 ? 1 : 0;
    const startStyle = pick(["fixed", "fixed", "equal", "zero"] as const);

    let t = window.startMs - int(0, 420) * 1000; // may begin before the lookback
    let start = BASE - 3 * 3600 * 1000;
    let value = int(0, 1000);
    let layout = pick(LAYOUTS);
    let buckets = layout.map(() => 0).concat(0);
    let sum = 0;

    while (t < window.endMs) {
      // Occasional gap around the 5-minute lookback.
      t += chance(0.08) ? int(200, 400) * 1000 : int(5, 60) * 1000;
      if (t >= window.endMs) break;
      if (chance(0.03)) temporality = temporality === 1 ? 2 : 1; // switch

      const marker = chance(0.05);
      const restart = temporality === 2 && chance(0.08);
      if (restart) {
        // A restart with a later start time, or a plain drop.
        if (chance(0.7)) start = t - int(1, 20) * 1000;
        value = 0;
        buckets = buckets.map(() => 0);
        sum = 0;
      }
      if (metricType === "Histogram" && temporality === 2 && chance(0.04)) {
        layout = pick(LAYOUTS);
        buckets = layout.map(() => 0).concat(0);
        sum = 0;
      }
      const pointStart =
        startStyle === "equal" ? t : startStyle === "zero" ? 0 : start;

      const base: RefPoint = {
        time: t,
        start: pointStart,
        unit,
        resource,
        flags: marker ? 1 : 0,
      };
      if (metricType !== "Summary") base.temporality = temporality;

      let point: RefPoint;
      if (metricType === "Sum") {
        const inc = int(0, 50);
        value = temporality === 2 ? value + inc : inc;
        point = { ...base, value: marker ? 0 : value };
      } else if (metricType === "Histogram") {
        const delta = buckets.map(() => (chance(0.6) ? int(0, 20) : 0));
        const deltaSum = delta.reduce((a, b) => a + b, 0) * int(1, 400);
        if (temporality === 2) {
          buckets = buckets.map((b, i) => b + delta[i]!);
          sum += deltaSum;
        }
        const out = temporality === 2 ? buckets : delta;
        point = {
          ...base,
          bounds: layout,
          buckets: marker ? out.map(() => 0) : [...out],
          count: marker ? 0 : out.reduce((a, b) => a + b, 0),
          sum: marker ? 0 : temporality === 2 ? sum : deltaSum,
        };
      } else {
        const qs = [0.5, 0.95, 0.99].filter(() => chance(0.8));
        value += 1;
        point = {
          ...base,
          count: value,
          sum: value * 10,
          quantiles: marker
            ? []
            : qs.map((quantile) => ({ quantile, value: int(1, 2000) })),
        };
      }
      points.push(point);
      if (chance(0.03)) points.push({ ...point }); // exporter retry
    }
  }

  const measures: RefMeasure[] =
    metricType === "Sum"
      ? [
          { op: "INCREASE", column: "Value", as: "inc" },
          { op: "RATE", column: "Value", as: "rate" },
          { op: "COUNT", as: "n" },
        ]
      : metricType === "Histogram"
        ? [
            { op: "HISTOGRAM_QUANTILE", quantile: 0.5, as: "p50" },
            { op: "HISTOGRAM_QUANTILE", quantile: 0.95, as: "p95" },
            { op: "HISTOGRAM_AVG", as: "avg" },
            { op: "INCREASE", column: "Count", as: "inc" },
            { op: "RATE", column: "Sum", as: "rate" },
          ]
        : [
            { op: "SUMMARY_QUANTILE", quantile: 0.95, as: "p95" },
            { op: "SUMMARY_QUANTILE", quantile: 0.5, as: "p50" },
            { op: "COUNT", as: "n" },
          ];

  return {
    seed,
    input: {
      metricType,
      window,
      ...(granularitySec !== undefined && { granularitySec }),
      ...(grouped && { groupBy: ["grp"] }),
      measures,
      points,
    },
  };
}
