import type { denormalizedSignals } from "@kopai/core";

type OtelMetricsRow = denormalizedSignals.OtelMetricsRow;

// Base timestamp: 2023-11-14T22:13:20Z in nanoseconds
// 5-minute window: 300_000ms
const BASE_NS = 1700000000000000000n;
const ts = (offsetMs: number) =>
  (BASE_NS + BigInt(offsetMs) * 1000000n).toString();

// Interval for 50 points over 5 minutes = 6000ms each
const INTERVAL_MS = 6000;

// ── Gauge: http.server.active_requests ──
// 2 series: GET and POST, 25 points each = 50 total

function gaugePoint(
  index: number,
  value: number,
  method: string
): OtelMetricsRow {
  return {
    MetricType: "Gauge" as const,
    MetricName: "http.server.active_requests",
    MetricDescription: "Number of active HTTP server requests",
    MetricUnit: "{requests}",
    TimeUnix: ts(index * INTERVAL_MS),
    StartTimeUnix: ts(0),
    Value: value,
    ServiceName: "api-gateway",
    Attributes: { "http.method": method },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
    },
    ScopeName: "opentelemetry.instrumentation.http",
    ScopeVersion: "0.44.0",
  };
}

// GET series: fluctuates between 5-45
const getValues = [
  12, 18, 24, 15, 22, 35, 28, 19, 31, 42, 38, 25, 14, 20, 33, 27, 16, 39, 44,
  30, 21, 11, 26, 36, 8,
];
// POST series: lower, fluctuates between 2-20
const postValues = [
  4, 7, 5, 9, 12, 8, 15, 6, 10, 18, 14, 7, 3, 11, 16, 9, 5, 13, 20, 12, 8, 4, 6,
  17, 2,
];

export const mockGaugeRows: OtelMetricsRow[] = [
  ...getValues.map((v, i) => gaugePoint(i, v, "GET")),
  ...postValues.map((v, i) => gaugePoint(i, v, "POST")),
];

// ── Sum: http.server.request_count ──
// 50 points, monotonically increasing, 2 series

function sumPoint(
  index: number,
  value: number,
  method: string
): OtelMetricsRow {
  return {
    MetricType: "Sum" as const,
    MetricName: "http.server.request_count",
    MetricDescription: "Total number of HTTP requests received",
    MetricUnit: "{requests}",
    TimeUnix: ts(index * INTERVAL_MS),
    StartTimeUnix: ts(0),
    Value: value,
    IsMonotonic: 1,
    AggregationTemporality: "CUMULATIVE",
    ServiceName: "api-gateway",
    Attributes: { "http.method": method },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
    },
    ScopeName: "opentelemetry.instrumentation.http",
    ScopeVersion: "0.44.0",
  };
}

// GET: starts at 1000, increases by 15-45 per interval
const getSumValues: number[] = [];
let getAccum = 1000;
for (let i = 0; i < 25; i++) {
  getSumValues.push(getAccum);
  getAccum += 15 + Math.floor(30 * Math.abs(Math.sin(i * 0.7)));
}

// POST: starts at 200, increases by 5-20 per interval
const postSumValues: number[] = [];
let postAccum = 200;
for (let i = 0; i < 25; i++) {
  postSumValues.push(postAccum);
  postAccum += 5 + Math.floor(15 * Math.abs(Math.sin(i * 0.5)));
}

export const mockSumRows: OtelMetricsRow[] = [
  ...getSumValues.map((v, i) => sumPoint(i, v, "GET")),
  ...postSumValues.map((v, i) => sumPoint(i, v, "POST")),
];

// ── Histogram: http.server.request_duration ──
// 3 data points with explicit bounds [5, 10, 25, 50, 75, 100, 250, 500, 1000]

const HISTOGRAM_BOUNDS = [5, 10, 25, 50, 75, 100, 250, 500, 1000];

export const mockHistogramRows: OtelMetricsRow[] = [
  {
    MetricType: "Histogram" as const,
    MetricName: "http.server.request_duration",
    MetricDescription: "Duration of HTTP server requests",
    MetricUnit: "ms",
    TimeUnix: ts(0),
    StartTimeUnix: ts(0),
    ServiceName: "api-gateway",
    Count: 1500,
    Sum: 87450,
    Min: 1,
    Max: 1850,
    ExplicitBounds: HISTOGRAM_BOUNDS,
    BucketCounts: [120, 280, 350, 310, 180, 120, 85, 35, 15, 5],
    AggregationTemporality: "CUMULATIVE",
    Attributes: { "http.method": "GET" },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
    },
    ScopeName: "opentelemetry.instrumentation.http",
    ScopeVersion: "0.44.0",
  },
  {
    MetricType: "Histogram" as const,
    MetricName: "http.server.request_duration",
    MetricDescription: "Duration of HTTP server requests",
    MetricUnit: "ms",
    TimeUnix: ts(60000),
    StartTimeUnix: ts(0),
    ServiceName: "api-gateway",
    Count: 3200,
    Sum: 192000,
    Min: 1,
    Max: 2100,
    ExplicitBounds: HISTOGRAM_BOUNDS,
    BucketCounts: [250, 580, 720, 640, 380, 280, 190, 95, 45, 20],
    AggregationTemporality: "CUMULATIVE",
    Attributes: { "http.method": "GET" },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
    },
    ScopeName: "opentelemetry.instrumentation.http",
    ScopeVersion: "0.44.0",
  },
  {
    MetricType: "Histogram" as const,
    MetricName: "http.server.request_duration",
    MetricDescription: "Duration of HTTP server requests",
    MetricUnit: "ms",
    TimeUnix: ts(120000),
    StartTimeUnix: ts(0),
    ServiceName: "api-gateway",
    Count: 4800,
    Sum: 278400,
    Min: 1,
    Max: 1950,
    ExplicitBounds: HISTOGRAM_BOUNDS,
    BucketCounts: [380, 850, 1100, 950, 560, 420, 310, 140, 65, 25],
    AggregationTemporality: "CUMULATIVE",
    Attributes: { "http.method": "GET" },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
    },
    ScopeName: "opentelemetry.instrumentation.http",
    ScopeVersion: "0.44.0",
  },
];

// ── Gauge: system.cpu.utilization ──
// 30 points, values 0-1 range, MetricUnit "1"

const cpuValues = [
  0.32, 0.35, 0.41, 0.38, 0.45, 0.52, 0.48, 0.55, 0.62, 0.58, 0.65, 0.71, 0.68,
  0.75, 0.82, 0.79, 0.73, 0.68, 0.61, 0.55, 0.48, 0.42, 0.38, 0.45, 0.52, 0.58,
  0.63, 0.57, 0.49, 0.44,
];

export const mockStatRows: OtelMetricsRow[] = cpuValues.map((value, i) => ({
  MetricType: "Gauge" as const,
  MetricName: "system.cpu.utilization",
  MetricDescription: "CPU utilization as a fraction (0.0 to 1.0)",
  MetricUnit: "1",
  TimeUnix: ts(i * 10000), // 10s intervals over 5 minutes
  StartTimeUnix: ts(0),
  Value: value,
  ServiceName: "api-gateway",
  Attributes: { "cpu.core": "all" },
  ResourceAttributes: {
    "service.name": "api-gateway",
    "service.version": "1.4.2",
    "deployment.environment": "production",
    "host.name": "api-gw-prod-01",
  },
  ScopeName: "opentelemetry.instrumentation.system",
  ScopeVersion: "0.44.0",
}));
