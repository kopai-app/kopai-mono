import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  GenericContainer,
  Network,
  Wait,
  type StartedTestContainer,
  type StartedNetwork,
} from "testcontainers";
import { ClickHouseReadDatasource } from "./datasource.js";
import {
  CLICKHOUSE_IMAGE,
  OTEL_COLLECTOR_IMAGE,
  CH_DATABASE,
  CH_USERNAME,
  CH_PASSWORD,
  CH_HTTP_PORT,
  CH_NATIVE_PORT,
  OTEL_HTTP_PORT,
  OTEL_HEALTH_PORT,
} from "./test/constants.js";
import { createOtelCollectorConfig } from "./test/otel-collector-config.js";
import {
  createTracesPayload,
  createLogsPayload,
  createMetricsPayload,
  TEST_TRACE_ID,
  TEST_SPAN_ID,
  TEST_PARENT_SPAN_ID,
  TEST_SERVICE_NAME,
  TEST_SCOPE_NAME,
  TEST_SCOPE_VERSION,
  TEST_LINK_TRACE_ID,
  TEST_LINK_SPAN_ID,
} from "./test/otel-payloads.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const CONTAINER_STARTUP_TIMEOUT = 120_000;
const DATA_SETTLE_TIMEOUT = 15_000;
const DATA_POLL_INTERVAL = 1_000;

let network: StartedNetwork;
let clickhouseContainer: StartedTestContainer;
let otelCollectorContainer: StartedTestContainer;
let adminClient: ClickHouseClient;
let ds: ClickHouseReadDatasource;
let collectorBaseUrl: string;

function requestContext() {
  return {
    database: CH_DATABASE,
    username: CH_USERNAME,
    password: CH_PASSWORD,
  };
}

/** Poll until data appears or timeout */
async function waitForData(
  check: () => Promise<boolean>,
  timeoutMs = DATA_SETTLE_TIMEOUT
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, DATA_POLL_INTERVAL));
  }
  throw new Error(`Timed out waiting for data after ${String(timeoutMs)}ms`);
}

beforeAll(async () => {
  // 1. Docker network
  network = await new Network().start();

  // 2. ClickHouse container
  clickhouseContainer = await new GenericContainer(CLICKHOUSE_IMAGE)
    .withNetwork(network)
    .withNetworkAliases("clickhouse")
    .withExposedPorts(CH_HTTP_PORT, CH_NATIVE_PORT)
    .withBindMounts([
      {
        source: path.join(dirname, "test-users.xml"),
        target: "/etc/clickhouse-server/users.d/test-users.xml",
      },
    ])
    .withWaitStrategy(
      Wait.forHttp("/", CH_HTTP_PORT).forResponsePredicate(
        (response) => response === "Ok.\n"
      )
    )
    .start();

  const chHost = clickhouseContainer.getHost();
  const chPort = clickhouseContainer.getMappedPort(CH_HTTP_PORT);
  const chBaseUrl = `http://${chHost}:${String(chPort)}`;

  adminClient = createClient({
    url: chBaseUrl,
    username: CH_USERNAME,
    password: CH_PASSWORD,
  });

  // 3. Create database (collector needs it pre-existing)
  await adminClient.command({
    query: `CREATE DATABASE IF NOT EXISTS ${CH_DATABASE}`,
  });

  // 4. Write OTEL collector config to tmp
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-otel-"));
  const configPath = path.join(tmpDir, "config.yaml");
  await fs.writeFile(configPath, createOtelCollectorConfig(), "utf-8");

  // 5. OTEL Collector container
  otelCollectorContainer = await new GenericContainer(OTEL_COLLECTOR_IMAGE)
    .withNetwork(network)
    .withNetworkAliases("otel-collector")
    .withExposedPorts(OTEL_HTTP_PORT, OTEL_HEALTH_PORT)
    .withBindMounts([
      { source: configPath, target: "/etc/otel/config.yaml", mode: "ro" },
    ])
    .withCommand(["--config=/etc/otel/config.yaml"])
    .withWaitStrategy(Wait.forHttp("/health", OTEL_HEALTH_PORT))
    .start();

  const otelHost = otelCollectorContainer.getHost();
  const otelPort = otelCollectorContainer.getMappedPort(OTEL_HTTP_PORT);
  collectorBaseUrl = `http://${otelHost}:${String(otelPort)}`;

  // 6. Datasource
  ds = new ClickHouseReadDatasource(chBaseUrl);

  // 7. Send all test telemetry
  await sendAllTelemetry();

  // 8. Wait for data to be ingested
  await waitForData(async () => {
    const traces = await ds.getTraces({ requestContext: requestContext() });
    const logs = await ds.getLogs({ requestContext: requestContext() });
    const gaugeMetrics = await ds.getMetrics({
      metricType: "Gauge",
      requestContext: requestContext(),
    });
    return (
      traces.data.length > 0 &&
      logs.data.length > 0 &&
      gaugeMetrics.data.length > 0
    );
  });
}, CONTAINER_STARTUP_TIMEOUT);

afterAll(async () => {
  await ds?.close();
  await adminClient?.close();
  if (otelCollectorContainer) await otelCollectorContainer.stop();
  if (clickhouseContainer) await clickhouseContainer.stop();
  if (network) await network.stop();
});

async function sendOtlp(endpoint: string, payload: unknown): Promise<void> {
  const response = await fetch(`${collectorBaseUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OTLP ${endpoint} failed: ${String(response.status)} ${body}`
    );
  }
}

async function sendAllTelemetry(): Promise<void> {
  await sendOtlp("/v1/traces", createTracesPayload());
  await sendOtlp("/v1/logs", createLogsPayload());
  await sendOtlp("/v1/metrics", createMetricsPayload());
}

describe("E2E: OTEL Collector → ClickHouse → ReadDatasource", () => {
  describe("getTraces", () => {
    it("reads traces ingested via OTEL collector", async () => {
      const result = await ds.getTraces({
        traceId: TEST_TRACE_ID,
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(2);
    });

    it("has correct span fields", async () => {
      const result = await ds.getTraces({
        traceId: TEST_TRACE_ID,
        spanId: TEST_PARENT_SPAN_ID,
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      const span = result.data[0]!;

      expect(span.TraceId).toBe(TEST_TRACE_ID);
      expect(span.SpanId).toBe(TEST_PARENT_SPAN_ID);
      expect(span.SpanName).toBe("GET /api/e2e-test");
      expect(span.ServiceName).toBe(TEST_SERVICE_NAME);
      expect(span.ScopeName).toBe(TEST_SCOPE_NAME);
      expect(span.ScopeVersion).toBe(TEST_SCOPE_VERSION);
      // SpanKind from OTEL: 2 = SERVER → CH stores as string
      expect(span.SpanKind).toBe("Server");
      expect(span.StatusCode).toBe("Ok");
      // Timestamp is nanoseconds string
      expect(BigInt(span.Timestamp)).toBeGreaterThan(0n);
      // Duration is nanoseconds string
      expect(span.Duration).toBeDefined();
    });

    it("has correct resource and span attributes", async () => {
      const result = await ds.getTraces({
        spanId: TEST_PARENT_SPAN_ID,
        requestContext: requestContext(),
      });

      const span = result.data[0]!;
      expect(span.ResourceAttributes?.["service.name"]).toBe(TEST_SERVICE_NAME);
      expect(span.SpanAttributes?.["http.method"]).toBe("GET");
      expect(span.SpanAttributes?.["http.status_code"]).toBe(200);
    });

    it("has events on child span", async () => {
      const result = await ds.getTraces({
        spanId: TEST_SPAN_ID,
        requestContext: requestContext(),
      });

      const span = result.data[0]!;
      expect(span["Events.Name"]).toContain("query_start");
      expect(span["Events.Timestamp"]?.length).toBeGreaterThan(0);
    });

    it("has links on child span", async () => {
      const result = await ds.getTraces({
        spanId: TEST_SPAN_ID,
        requestContext: requestContext(),
      });

      const span = result.data[0]!;
      expect(span["Links.TraceId"]).toContain(TEST_LINK_TRACE_ID);
      expect(span["Links.SpanId"]).toContain(TEST_LINK_SPAN_ID);
    });

    it("filters by serviceName", async () => {
      const result = await ds.getTraces({
        serviceName: TEST_SERVICE_NAME,
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(2);
      expect(
        result.data.every((r) => r.ServiceName === TEST_SERVICE_NAME)
      ).toBe(true);
    });

    it("filters by spanAttributes", async () => {
      const result = await ds.getTraces({
        spanAttributes: { "db.system": "postgresql" },
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      expect(result.data[0]!.SpanName).toBe("DB query");
    });
  });

  describe("getLogs", () => {
    it("reads logs ingested via OTEL collector", async () => {
      const result = await ds.getLogs({
        serviceName: TEST_SERVICE_NAME,
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(2);
    });

    it("has correct log fields", async () => {
      const result = await ds.getLogs({
        severityText: "INFO",
        serviceName: TEST_SERVICE_NAME,
        requestContext: requestContext(),
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
      const log = result.data[0]!;

      expect(log.Body).toBe("E2E test log message");
      expect(log.SeverityText).toBe("INFO");
      expect(log.SeverityNumber).toBe(9);
      expect(log.ServiceName).toBe(TEST_SERVICE_NAME);
      expect(log.ScopeName).toBe(TEST_SCOPE_NAME);
      expect(log.TraceId).toBe(TEST_TRACE_ID);
      expect(log.SpanId).toBe(TEST_SPAN_ID);
      expect(BigInt(log.Timestamp)).toBeGreaterThan(0n);
    });

    it("has correct log attributes", async () => {
      const result = await ds.getLogs({
        severityText: "INFO",
        serviceName: TEST_SERVICE_NAME,
        requestContext: requestContext(),
      });

      const log = result.data[0]!;
      expect(log.LogAttributes?.["log.source"]).toBe("e2e-test");
      expect(log.ResourceAttributes?.["service.name"]).toBe(TEST_SERVICE_NAME);
    });

    it("filters by bodyContains", async () => {
      const result = await ds.getLogs({
        bodyContains: "error",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(
        result.data.every((r) => r.Body?.toLowerCase().includes("error"))
      ).toBe(true);
    });

    it("filters by severity range", async () => {
      const result = await ds.getLogs({
        severityNumberMin: 17,
        serviceName: TEST_SERVICE_NAME,
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      expect(result.data[0]!.SeverityText).toBe("ERROR");
    });
  });

  describe("getMetrics", () => {
    it("reads Gauge metrics", async () => {
      const result = await ds.getMetrics({
        metricType: "Gauge",
        metricName: "e2e.test.gauge",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      const m = result.data[0]!;
      expect(m.MetricType).toBe("Gauge");
      if (m.MetricType === "Gauge") {
        expect(m.Value).toBe(42.5);
      }
      expect(m.MetricName).toBe("e2e.test.gauge");
      expect(m.MetricDescription).toBe("E2E test gauge metric");
      expect(m.MetricUnit).toBe("1");
      expect(m.ServiceName).toBe(TEST_SERVICE_NAME);
      expect(m.Attributes?.["region"]).toBe("us-east");
    });

    it("reads Sum metrics", async () => {
      const result = await ds.getMetrics({
        metricType: "Sum",
        metricName: "e2e.test.sum",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      const m = result.data[0]!;
      expect(m.MetricType).toBe("Sum");
      if (m.MetricType === "Sum") {
        expect(m.Value).toBe(100);
        expect(m.IsMonotonic).toBe(1);
      }
    });

    it("reads Histogram metrics", async () => {
      const result = await ds.getMetrics({
        metricType: "Histogram",
        metricName: "e2e.test.histogram",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      const m = result.data[0]!;
      expect(m.MetricType).toBe("Histogram");
      if (m.MetricType === "Histogram") {
        expect(m.Count).toBe(10);
        expect(m.Sum).toBe(500);
        expect(m.Min).toBe(5);
        expect(m.Max).toBe(95);
        expect(m.BucketCounts).toEqual([1, 2, 3, 4]);
        expect(m.ExplicitBounds).toEqual([10, 50, 100]);
      }
    });

    it("reads ExponentialHistogram metrics", async () => {
      const result = await ds.getMetrics({
        metricType: "ExponentialHistogram",
        metricName: "e2e.test.exponential_histogram",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      const m = result.data[0]!;
      expect(m.MetricType).toBe("ExponentialHistogram");
      if (m.MetricType === "ExponentialHistogram") {
        expect(m.Count).toBe(5);
        expect(m.Sum).toBe(250);
        expect(m.Scale).toBe(1);
        expect(m.PositiveBucketCounts).toEqual([1, 2, 2]);
      }
    });

    it("reads Summary metrics", async () => {
      const result = await ds.getMetrics({
        metricType: "Summary",
        metricName: "e2e.test.summary",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      const m = result.data[0]!;
      expect(m.MetricType).toBe("Summary");
      if (m.MetricType === "Summary") {
        expect(m.Count).toBe(100);
        expect(m.Sum).toBe(5000);
        expect(m["ValueAtQuantiles.Quantile"]).toEqual([0.5, 0.95, 0.99]);
        expect(m["ValueAtQuantiles.Value"]).toEqual([50, 95, 99]);
      }
    });

    it("has correct timestamps as nanos", async () => {
      const result = await ds.getMetrics({
        metricType: "Gauge",
        metricName: "e2e.test.gauge",
        requestContext: requestContext(),
      });

      const m = result.data[0]!;
      expect(BigInt(m.TimeUnix)).toBeGreaterThan(0n);
      expect(BigInt(m.StartTimeUnix)).toBeGreaterThan(0n);
      expect(BigInt(m.TimeUnix)).toBeGreaterThan(BigInt(m.StartTimeUnix));
    });
  });

  describe("discoverMetrics", () => {
    it("discovers all 5 metric types", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      const names = result.metrics.map((m) => m.name).sort();
      expect(names).toContain("e2e.test.gauge");
      expect(names).toContain("e2e.test.sum");
      expect(names).toContain("e2e.test.histogram");
      expect(names).toContain("e2e.test.exponential_histogram");
      expect(names).toContain("e2e.test.summary");
    });

    it("returns correct metric metadata", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      const gauge = result.metrics.find((m) => m.name === "e2e.test.gauge");
      expect(gauge).toBeDefined();
      expect(gauge!.type).toBe("Gauge");
      expect(gauge!.unit).toBe("1");
      expect(gauge!.description).toBe("E2E test gauge metric");
    });

    it("returns attribute keys and values", async () => {
      const result = await ds.discoverMetrics({
        requestContext: requestContext(),
      });

      const gauge = result.metrics.find((m) => m.name === "e2e.test.gauge");
      expect(gauge).toBeDefined();
      expect(gauge!.attributes.values).toHaveProperty("region");
      expect(gauge!.attributes.values["region"]).toContain("us-east");
      expect(gauge!.resourceAttributes.values).toHaveProperty("service.name");
    });
  });
});
