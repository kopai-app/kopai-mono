/// <reference types="vitest/globals" />
/**
 * Service Map scan budget benchmark (Q11 / NFR4).
 *
 * The Service Map UI builds its graph in the browser by paging through recent
 * spans. Its scan is budgeted so it cannot starve ingest on the SQLite backend:
 * one request at a time, at least 100 ms between requests and at most 1000
 * spans per page. The shipped engine allows `SCAN_MAX_REQUESTS = 50` requests
 * per scan (a seed of getServices + 2 aggregates, DESC pages, and a
 * `PROBE_RESERVE` of 15 for probes). This file deliberately measures the Q11
 * upper bound instead, 200 requests (2 seed aggregates + up to 198 DESC
 * pages), as a worst case for what that pattern costs the collector path.
 *
 * It opens a temporary FILE database exactly the way the app does
 * (`initializeDatabase(path)` + `createOptimizedDatasource`), because the real
 * server writes to `SQLITE_DB_FILE_PATH` and `:memory:` understates write and
 * lock cost. It seeds about 200k spans over the last 60 minutes, then records
 * ingest latency (`writeTraces` batches of 100 spans every 50 ms, measured from
 * the batch's scheduled start so event-loop blocking by a scan page counts) for
 * a baseline phase and again while the scan runs in the same process, as the
 * app runs API and collector in one process.
 *
 * NOT A CI GATE. The suite only runs with `KOPAI_BENCH=1`:
 *
 *   KOPAI_BENCH=1 pnpm vitest run packages/sqlite-datasource/src/service-map-scan-budget.perf.test.ts
 *
 * Shared CI runners vary about 25x in speed and widely run to run (see the
 * comment in the root `vitest.config.ts`), so any latency threshold would be
 * flaky there. The assertion below is deliberately loose (under-scan p99 <=
 * max(3 x baseline p99, baseline p99 + 50 ms)); the printed numbers are the
 * real output.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { DatabaseSync } from "node:sqlite";
import { otlp, type datasource, type kopaiQuery } from "@kopai/core";
import { initializeDatabase } from "./initialize-database.js";
import {
  createOptimizedDatasource,
  type OptimizedDatasource,
} from "./optimized-datasource.js";

const MINUTE_MS = 60_000;
const WINDOW_MS = 60 * MINUTE_MS; // M = 60 min
const DELAY_MS = 30_000; // forward-poll delay; scan upper bound is now − 30 s
const SEED_SPANS = 200_000;
const SEED_BATCH = 2_000;
const SERVICES = 20;

const INGEST_BATCH = 100;
const INGEST_INTERVAL_MS = 50;
const BASELINE_MS = 30_000;

const PAGE_LIMIT = 1000;
const MIN_GAP_MS = 100;
// Q11 upper bound, measured on purpose as the worst case; the shipped engine's
// budget is SCAN_MAX_REQUESTS = 50 (packages/ui ServiceMap/engine/config.ts).
const REQUEST_BUDGET = 200;
const SEED_REQUESTS = 2;
const MAX_PAGES = REQUEST_BUDGET - SEED_REQUESTS; // 198

const BENCH = process.env.KOPAI_BENCH === "1";

// ---------------------------------------------------------------- helpers

const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** Deterministic PRNG (mulberry32) so every run seeds the same shape. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexId(rand: () => number, bytes: number): string {
  let s = "";
  for (let i = 0; i < bytes; i++) {
    s += Math.floor(rand() * 256)
      .toString(16)
      .padStart(2, "0");
  }
  return s;
}

const nsOf = (ms: number) => (BigInt(Math.floor(ms)) * 1_000_000n).toString();

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

interface Stats {
  n: number;
  p50: number;
  p99: number;
  max: number;
  mean: number;
}

function stats(samples: readonly number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    p50: percentile(sorted, 0.5),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? 0,
    mean: sorted.length ? sum / sorted.length : 0,
  };
}

// ---------------------------------------------------------- span builder

type Attrs = Record<string, string | number>;

interface SpanSpec {
  service: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: otlp.SpanKind;
  startMs: number;
  durMs: number;
  error: boolean;
  attrs: Attrs;
}

function toAttr([key, v]: [string, string | number]) {
  return typeof v === "number"
    ? { key, value: { intValue: String(v) } }
    : { key, value: { stringValue: v } };
}

/** Groups specs by service into one OTLP `TracesData` (one resource each). */
function toTracesData(specs: readonly SpanSpec[]): datasource.TracesData {
  const byService = new Map<string, SpanSpec[]>();
  for (const s of specs) {
    const list = byService.get(s.service);
    if (list) list.push(s);
    else byService.set(s.service, [s]);
  }
  return {
    resourceSpans: [...byService].map(([service, spans]) => ({
      resource: {
        attributes: [
          toAttr(["service.name", service]),
          toAttr(["service.version", "1.4.2"]),
          toAttr(["deployment.environment", "bench"]),
          toAttr(["host.name", `${service}-7d9f8c6b5-x2k4p`]),
          toAttr(["telemetry.sdk.language", "nodejs"]),
        ],
      },
      scopeSpans: [
        {
          scope: {
            name: "@opentelemetry/instrumentation-http",
            version: "0.52.0",
          },
          spans: spans.map((s) => ({
            traceId: s.traceId,
            spanId: s.spanId,
            parentSpanId: s.parentSpanId,
            name: s.name,
            kind: s.kind,
            startTimeUnixNano: nsOf(s.startMs),
            endTimeUnixNano: nsOf(s.startMs + s.durMs),
            attributes: Object.entries(s.attrs).map(toAttr),
            status: s.error
              ? { code: otlp.StatusCode.STATUS_CODE_ERROR, message: "boom" }
              : { code: otlp.StatusCode.STATUS_CODE_UNSET },
          })),
        },
      ],
    })),
  };
}

const SERVICE_NAMES = Array.from({ length: SERVICES }, (_, i) =>
  i === 0 ? "frontend" : i < 3 ? `gateway-${i}` : `svc-${i}`
);

/**
 * One trace of 8 spans: frontend server → gateway (client/server pair) →
 * backend (client/server pair) with a postgres client call, a kafka producer
 * and an internal span. Cross-service parent/child pairs exercise exactly what
 * the Service Map joins on.
 */
function makeTrace(rand: () => number, startMs: number): SpanSpec[] {
  const traceId = hexId(rand, 16);
  const id = () => hexId(rand, 8);
  const gw = SERVICE_NAMES[1 + Math.floor(rand() * 2)] ?? "gateway-1";
  const be = SERVICE_NAMES[3 + Math.floor(rand() * (SERVICES - 3))] ?? "svc-3";
  const err = rand() < 0.03;
  const route = `/api/v1/orders/${Math.floor(rand() * 1000)}`;
  const http = (method: string): Attrs => ({
    "http.request.method": method,
    "url.path": route,
    "http.route": "/api/v1/orders/:id",
    "http.response.status_code": err ? 500 : 200,
    "user_agent.original":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0",
  });
  const root = id();
  const gwClient = id();
  const gwServer = id();
  const beClient = id();
  const beServer = id();
  const t = startMs;
  return [
    {
      service: "frontend",
      traceId,
      spanId: root,
      name: "GET /orders",
      kind: otlp.SpanKind.SPAN_KIND_SERVER,
      startMs: t,
      durMs: 40,
      error: err,
      attrs: http("GET"),
    },
    {
      service: "frontend",
      traceId,
      spanId: gwClient,
      parentSpanId: root,
      name: "GET",
      kind: otlp.SpanKind.SPAN_KIND_CLIENT,
      startMs: t + 1,
      durMs: 36,
      error: err,
      attrs: { ...http("GET"), "server.address": gw, "peer.service": gw },
    },
    {
      service: gw,
      traceId,
      spanId: gwServer,
      parentSpanId: gwClient,
      name: "GET /api/v1/orders/:id",
      kind: otlp.SpanKind.SPAN_KIND_SERVER,
      startMs: t + 2,
      durMs: 34,
      error: err,
      attrs: http("GET"),
    },
    {
      service: gw,
      traceId,
      spanId: beClient,
      parentSpanId: gwServer,
      name: "POST",
      kind: otlp.SpanKind.SPAN_KIND_CLIENT,
      startMs: t + 3,
      durMs: 30,
      error: err,
      attrs: {
        ...http("POST"),
        "server.address": `${be}.default.svc.cluster.local`,
      },
    },
    {
      service: be,
      traceId,
      spanId: beServer,
      parentSpanId: beClient,
      name: "POST /orders",
      kind: otlp.SpanKind.SPAN_KIND_SERVER,
      startMs: t + 4,
      durMs: 28,
      error: err,
      attrs: http("POST"),
    },
    {
      service: be,
      traceId,
      spanId: id(),
      parentSpanId: beServer,
      name: "SELECT orders",
      kind: otlp.SpanKind.SPAN_KIND_CLIENT,
      startMs: t + 5,
      durMs: 8,
      error: false,
      attrs: {
        "db.system.name": "postgresql",
        "db.namespace": "shop",
        "db.query.text":
          "SELECT id, total, status FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20",
        "server.address": "postgres.default.svc.cluster.local",
        "server.port": 5432,
      },
    },
    {
      service: be,
      traceId,
      spanId: id(),
      parentSpanId: beServer,
      name: "orders.created publish",
      kind: otlp.SpanKind.SPAN_KIND_PRODUCER,
      startMs: t + 15,
      durMs: 3,
      error: false,
      attrs: {
        "messaging.system": "kafka",
        "messaging.destination.name": "orders.created",
        "messaging.operation.type": "publish",
      },
    },
    {
      service: be,
      traceId,
      spanId: id(),
      parentSpanId: beServer,
      name: "validate order",
      kind: otlp.SpanKind.SPAN_KIND_INTERNAL,
      startMs: t + 19,
      durMs: 5,
      error: false,
      attrs: { "code.function.name": "validateOrder" },
    },
  ];
}

const SPANS_PER_TRACE = 8;

function makeSpans(
  rand: () => number,
  count: number,
  startMs: (i: number) => number
): SpanSpec[] {
  const out: SpanSpec[] = [];
  for (let i = 0; out.length < count; i++)
    out.push(...makeTrace(rand, startMs(i)));
  return out.slice(0, count);
}

// ------------------------------------------------------ scan (§0 pattern)

/** The two A1 seed aggregate bodies, same shape as the UI's `buildSeedQueries`. */
function seedQueries(nowMs: number): kopaiQuery.TraceAggregateQuery[] {
  const timeDimension = {
    type: "absolute" as const,
    startTime: new Date(nowMs - WINDOW_MS).toISOString(),
    endTime: new Date(nowMs).toISOString(),
  };
  return [
    {
      signal: "traces",
      mode: "aggregate",
      timeDimension,
      dimensions: ["service.name", "SpanKind"],
      measures: [
        { op: "COUNT", as: "spans" },
        { op: "ERROR_RATE", as: "errRate" },
      ],
      output: { type: "summary" },
      limit: 10_000,
    },
    {
      signal: "traces",
      mode: "aggregate",
      timeDimension,
      filters: [
        { column: "SpanKind", op: "in", values: ["Client", "Producer"] },
      ],
      dimensions: [
        "service.name",
        { container: "SpanAttributes", key: "peer.service" },
        "db.system.name",
        "db.namespace",
        "messaging.system",
        "messaging.destination.name",
        "messaging.operation.type",
        "server.address",
      ],
      measures: [
        { op: "COUNT", as: "calls" },
        { op: "ERROR_RATE", as: "errRate" },
      ],
      output: { type: "summary" },
      limit: 10_000,
    },
  ];
}

interface ScanResult {
  requests: number;
  pages: number;
  spans: number;
  seedRows: number;
  stop: "no-more-data" | "budget";
  aggregateMs: number[];
  pageMs: number[];
  minGapMs: number;
  coveredMs: number;
}

/** Seed (2 aggregates) then serial DESC pages, ≥100 ms apart, ≤200 requests. */
async function runScan(ds: OptimizedDatasource): Promise<ScanResult> {
  const nowMs = Date.now();
  const t0 = nowMs - DELAY_MS;
  const r: ScanResult = {
    requests: 0,
    pages: 0,
    spans: 0,
    seedRows: 0,
    stop: "no-more-data",
    aggregateMs: [],
    pageMs: [],
    minGapMs: Infinity,
    coveredMs: 0,
  };
  let lastEnd = -Infinity;
  const gate = async () => {
    // Timers may fire a fraction of a millisecond early; re-check.
    while (performance.now() < lastEnd + MIN_GAP_MS) {
      await sleep(lastEnd + MIN_GAP_MS - performance.now() + 1);
    }
    const now = performance.now();
    if (Number.isFinite(lastEnd))
      r.minGapMs = Math.min(r.minGapMs, now - lastEnd);
    r.requests++;
    return now;
  };

  for (const q of seedQueries(nowMs)) {
    const start = await gate();
    const res = await ds.queryTracesAggregate(q);
    lastEnd = performance.now();
    r.aggregateMs.push(lastEnd - start);
    r.seedRows += res.data.length;
  }

  let cursor: string | undefined;
  let oldestNs: bigint | null = null;
  const minNs = nsOf(nowMs - WINDOW_MS);
  const maxNs = (BigInt(nsOf(t0)) - 1n).toString();
  for (;;) {
    if (r.requests >= REQUEST_BUDGET) {
      r.stop = "budget";
      break;
    }
    const start = await gate();
    const page = await ds.getTraces({
      timestampMin: minNs,
      timestampMax: maxNs,
      sortOrder: "DESC",
      limit: PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    });
    lastEnd = performance.now();
    r.pageMs.push(lastEnd - start);
    r.pages++;
    r.spans += page.data.length;
    const last = page.data[page.data.length - 1];
    if (last) oldestNs = BigInt(last.Timestamp);
    if (!page.nextCursor || page.data.length === 0) break;
    cursor = page.nextCursor;
  }
  if (oldestNs !== null) {
    r.coveredMs = Math.max(0, t0 - Number(oldestNs / 1_000_000n));
  }
  return r;
}

// ------------------------------------------------------------ ingest load

interface IngestResult {
  latencyMs: number[];
  spansPerSec: number;
  loopP99Ms: number;
  loopMaxMs: number;
}

/**
 * Writes a batch of fresh "now" spans every 50 ms until `until()` is true.
 * Latency is measured from the batch's scheduled start, so time the event loop
 * spent blocked by a scan page is included, as a collector request would see.
 *
 * The schedule never builds a backlog: a batch is due 50 ms after the previous
 * one was due, or when the previous one finished if that is later. On a slow
 * machine 100 spans can take about 50 ms to write (the write path compiles and
 * prepares each row), so a fixed-rate schedule would measure an ever-growing
 * queue instead of the write itself. The achieved span rate is reported.
 */
async function runIngest(
  ds: OptimizedDatasource,
  rand: () => number,
  until: () => boolean
): Promise<IngestResult> {
  const h = monitorEventLoopDelay({ resolution: 5 });
  h.enable();
  const latencyMs: number[] = [];
  const origin = performance.now();
  let due = origin;
  let spans = 0;
  while (!until()) {
    await sleep(due - performance.now());
    const now = Date.now();
    const batch = makeSpans(rand, INGEST_BATCH, (k) => now - 50 + k);
    await ds.writeTraces(toTracesData(batch));
    const done = performance.now();
    latencyMs.push(done - due);
    spans += batch.length;
    due = Math.max(due + INGEST_INTERVAL_MS, done);
  }
  h.disable();
  return {
    latencyMs,
    spansPerSec: spans / ((performance.now() - origin) / 1000),
    loopP99Ms: h.percentile(99) / 1e6,
    loopMaxMs: h.max / 1e6,
  };
}

// ------------------------------------------------------------------ suite

describe.runIf(BENCH)(
  "Service Map scan budget vs SQLite ingest (bench)",
  () => {
    let dir: string;
    let db: DatabaseSync;
    let ds: OptimizedDatasource;

    beforeAll(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "kopai-bench-"));
      db = initializeDatabase(path.join(dir, "bench.db"));
      ds = createOptimizedDatasource(db);

      const rand = prng(42);
      const nowMs = Date.now();
      const traces = SEED_SPANS / SPANS_PER_TRACE;
      const spanMs = (WINDOW_MS - 60_000) / traces; // spread across 60 min
      let written = 0;
      for (let i = 0; written < SEED_SPANS; i++) {
        const base = written / SPANS_PER_TRACE;
        const batch = makeSpans(
          rand,
          Math.min(SEED_BATCH, SEED_SPANS - written),
          (k) => nowMs - WINDOW_MS + 30_000 + (base + k) * spanMs
        );
        await ds.writeTraces(toTracesData(batch));
        written += batch.length;
      }
    }, 300_000);

    afterAll(() => {
      db?.close();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });

    it("keeps ingest p99 within a loose bound while a full-budget scan runs", async () => {
      const rand = prng(7);

      const baselineEnd = performance.now() + BASELINE_MS;
      const baseline = await runIngest(
        ds,
        rand,
        () => performance.now() >= baselineEnd
      );

      let scanDone = false;
      const scanP = runScan(ds).finally(() => {
        scanDone = true;
      });
      const underScan = await runIngest(ds, rand, () => scanDone);
      const scan = await scanP;

      const b = stats(baseline.latencyMs);
      const u = stats(underScan.latencyMs);
      const pages = stats(scan.pageMs);
      const f = (n: number) => n.toFixed(1);
      const rows = [
        [
          "phase",
          "batches",
          "p50 ms",
          "p99 ms",
          "max ms",
          "loop p99 ms",
          "loop max ms",
          "spans/s",
        ],
        [
          "baseline",
          b.n,
          f(b.p50),
          f(b.p99),
          f(b.max),
          f(baseline.loopP99Ms),
          f(baseline.loopMaxMs),
          baseline.spansPerSec.toFixed(0),
        ],
        [
          "under scan",
          u.n,
          f(u.p50),
          f(u.p99),
          f(u.max),
          f(underScan.loopP99Ms),
          f(underScan.loopMaxMs),
          underScan.spansPerSec.toFixed(0),
        ],
      ].map((r) => r.map(String));
      const widths = rows[0]!.map((_, c) =>
        Math.max(...rows.map((r) => r[c]!.length))
      );
      const table = rows
        .map((r) => r.map((cell, c) => cell.padEnd(widths[c]!)).join("  "))
        .join("\n");
      const bound = Math.max(3 * b.p99, b.p99 + 50);
      // Written straight to stdout: vitest hides console output of passing
      // tests, and the numbers are the point of this file.
      process.stdout.write(
        [
          "",
          `Service Map scan budget benchmark — file DB, ${SEED_SPANS} seeded spans, ${SERVICES} services`,
          `ingest: ${INGEST_BATCH} spans every ${INGEST_INTERVAL_MS} ms (latency from scheduled start)`,
          table,
          `scan: ${scan.requests} requests (${SEED_REQUESTS} aggregates + ${scan.pages} pages), ${scan.spans} spans, stop=${scan.stop}, covers ${f(scan.coveredMs / MINUTE_MS)} of 60 min`,
          `aggregates ms: ${scan.aggregateMs.map(f).join(", ")} (seed rows ${scan.seedRows})`,
          `scan page ms: mean ${f(pages.mean)}, p50 ${f(pages.p50)}, p99 ${f(pages.p99)}, max ${f(pages.max)}; min gap ${f(scan.minGapMs)} ms`,
          `gate: under-scan p99 ${f(u.p99)} ms <= ${f(bound)} ms`,
          "",
        ].join("\n") + "\n"
      );

      // The scan honoured the §0 budget.
      expect(scan.requests).toBeLessThanOrEqual(REQUEST_BUDGET);
      expect(scan.pages).toBeLessThanOrEqual(MAX_PAGES);
      expect(scan.pages).toBeGreaterThan(1);
      expect(scan.seedRows).toBeGreaterThan(0);
      expect(scan.minGapMs).toBeGreaterThanOrEqual(MIN_GAP_MS - 1);
      // Both phases actually measured something.
      expect(b.n).toBeGreaterThan(100);
      expect(u.n).toBeGreaterThan(10);
      // Loose gate (NFR4's X was never set): the recorded numbers are the output.
      expect(u.p99).toBeLessThanOrEqual(bound);
    }, 600_000);
  }
);

describe("service-map scan budget bench helpers", () => {
  it("percentile picks the nearest-rank value", () => {
    const s = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(s, 0.5)).toBe(50);
    expect(percentile(s, 0.99)).toBe(99);
    expect(percentile([], 0.99)).toBe(0);
    expect(percentile([5], 0.99)).toBe(5);
  });
});
