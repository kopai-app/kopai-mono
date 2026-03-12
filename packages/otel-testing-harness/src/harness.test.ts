/// <reference types="vitest/globals" />
import { createOtelTestingHarness, type OtelTestingHarness } from "./index.js";

import { trace, metrics } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPTraceExporter as OTLPTraceExporterProto } from "@opentelemetry/exporter-trace-otlp-proto";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPMetricExporter as OTLPMetricExporterProto } from "@opentelemetry/exporter-metrics-otlp-proto";
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPLogExporter as OTLPLogExporterProto } from "@opentelemetry/exporter-logs-otlp-proto";
import net from "node:net";

function assertDefined<T>(
  value: T | undefined | null,
  msg?: string
): asserts value is T {
  if (value === undefined || value === null) {
    throw new Error(msg ?? "Expected value to be defined");
  }
}

describe("lifecycle", () => {
  it("creates harness and listens on a port", async () => {
    const harness = await createOtelTestingHarness({ port: 0 });
    try {
      expect(harness.port).toBeGreaterThan(0);
    } finally {
      await harness.stop();
    }
  });

  it("stop() closes server so port can be re-bound", async () => {
    const harness = await createOtelTestingHarness({ port: 0 });
    const port = harness.port;
    await harness.stop();

    // Brief delay to allow OS to release the TCP socket
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should be able to bind the same port again
    const harness2 = await createOtelTestingHarness({ port });
    try {
      expect(harness2.port).toBe(port);
    } finally {
      await harness2.stop();
    }
  });

  it("port conflict fails fast", async () => {
    // Bind a port with a raw TCP server
    const server = net.createServer();
    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        } else {
          reject(new Error("Failed to get port"));
        }
      });
    });

    try {
      await expect(
        createOtelTestingHarness({ port, host: "127.0.0.1" })
      ).rejects.toThrow(/already in use/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("traces (JSON)", () => {
  let harness: OtelTestingHarness;
  let tracerProvider: BasicTracerProvider;

  beforeEach(async () => {
    harness = await createOtelTestingHarness({ port: 0, host: "127.0.0.1" });

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "test-service",
    });

    tracerProvider = new BasicTracerProvider({
      resource,
      spanProcessors: [
        new SimpleSpanProcessor(
          new OTLPTraceExporter({
            url: `http://127.0.0.1:${harness.port}/v1/traces`,
          })
        ),
      ],
    });
    trace.setGlobalTracerProvider(tracerProvider);
  });

  afterEach(async () => {
    await tracerProvider.shutdown();
    trace.disable();
    await harness.stop();
  });

  it("send span via OTel SDK and retrieve via getTraces()", async () => {
    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("test-span");
    span.setAttribute("test.attr", "value");
    span.end();

    await tracerProvider.forceFlush();

    const result = await harness.getTraces({});
    expect(result.data.length).toBeGreaterThanOrEqual(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.SpanName).toBe("test-span");
  });

  it("filter by traceId works", async () => {
    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("filtered-span");
    const traceId = span.spanContext().traceId;
    span.end();

    await tracerProvider.forceFlush();

    const result = await harness.getTraces({ traceId });
    expect(result.data.length).toBe(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.TraceId).toBe(traceId);
  });
});

describe("metrics (JSON)", () => {
  let harness: OtelTestingHarness;
  let meterProvider: MeterProvider;

  beforeEach(async () => {
    harness = await createOtelTestingHarness({ port: 0, host: "127.0.0.1" });

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "test-service",
    });

    meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: `http://127.0.0.1:${harness.port}/v1/metrics`,
          }),
          exportIntervalMillis: 60000,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);
  });

  afterEach(async () => {
    await meterProvider.shutdown();
    metrics.disable();
    await harness.stop();
  });

  it("send counter and retrieve via getMetrics()", async () => {
    const meter = metrics.getMeter("test");
    const counter = meter.createCounter("test.counter");
    counter.add(42, { "test.attr": "value" });

    await meterProvider.forceFlush();

    const result = await harness.getMetrics({ metricType: "Sum" });
    expect(result.data.length).toBeGreaterThanOrEqual(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.MetricName).toBe("test.counter");
  });

  it("discoverMetrics() returns metric metadata", async () => {
    const meter = metrics.getMeter("test");
    const counter = meter.createCounter("test.discovered");
    counter.add(1);

    await meterProvider.forceFlush();

    const discovery = await harness.discoverMetrics();
    expect(discovery.metrics.length).toBeGreaterThanOrEqual(1);
    const found = discovery.metrics.find((m) => m.name === "test.discovered");
    assertDefined(found);
    expect(found.type).toBe("Sum");
  });
});

describe("logs (JSON)", () => {
  let harness: OtelTestingHarness;
  let loggerProvider: LoggerProvider;

  beforeEach(async () => {
    harness = await createOtelTestingHarness({ port: 0, host: "127.0.0.1" });

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "test-service",
    });

    loggerProvider = new LoggerProvider({
      resource,
      processors: [
        new SimpleLogRecordProcessor(
          new OTLPLogExporter({
            url: `http://127.0.0.1:${harness.port}/v1/logs`,
          })
        ),
      ],
    });
    logs.setGlobalLoggerProvider(loggerProvider);
  });

  afterEach(async () => {
    await loggerProvider.shutdown();
    logs.disable();
    await harness.stop();
  });

  it("emit log and retrieve via getLogs()", async () => {
    const logger = logs.getLogger("test");
    logger.emit({
      body: "Test log message",
      severityNumber: 9,
      severityText: "INFO",
    });

    await vi.waitFor(async () => {
      const result = await harness.getLogs({});
      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });

    const result = await harness.getLogs({});
    const row = result.data[0];
    assertDefined(row);
    expect(row.Body).toBe("Test log message");
  });
});

describe("protobuf encoding", () => {
  let harness: OtelTestingHarness;
  let tracerProvider: BasicTracerProvider;
  let meterProvider: MeterProvider;
  let loggerProvider: LoggerProvider;

  beforeEach(async () => {
    harness = await createOtelTestingHarness({ port: 0, host: "127.0.0.1" });

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "test-service-proto",
    });

    tracerProvider = new BasicTracerProvider({
      resource,
      spanProcessors: [
        new SimpleSpanProcessor(
          new OTLPTraceExporterProto({
            url: `http://127.0.0.1:${harness.port}/v1/traces`,
          })
        ),
      ],
    });
    trace.setGlobalTracerProvider(tracerProvider);

    meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporterProto({
            url: `http://127.0.0.1:${harness.port}/v1/metrics`,
          }),
          exportIntervalMillis: 60000,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);

    loggerProvider = new LoggerProvider({
      resource,
      processors: [
        new SimpleLogRecordProcessor(
          new OTLPLogExporterProto({
            url: `http://127.0.0.1:${harness.port}/v1/logs`,
          })
        ),
      ],
    });
    logs.setGlobalLoggerProvider(loggerProvider);
  });

  afterEach(async () => {
    await tracerProvider.shutdown();
    await meterProvider.shutdown();
    await loggerProvider.shutdown();
    trace.disable();
    metrics.disable();
    logs.disable();
    await harness.stop();
  });

  it("traces via proto exporter", async () => {
    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("proto-span");
    span.end();

    await tracerProvider.forceFlush();

    const result = await harness.getTraces({});
    expect(result.data.length).toBeGreaterThanOrEqual(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.SpanName).toBe("proto-span");
  });

  it("metrics via proto exporter", async () => {
    const meter = metrics.getMeter("test");
    const counter = meter.createCounter("proto.counter");
    counter.add(1);

    await meterProvider.forceFlush();

    const result = await harness.getMetrics({ metricType: "Sum" });
    expect(result.data.length).toBeGreaterThanOrEqual(1);
    const row = result.data[0];
    assertDefined(row);
    expect(row.MetricName).toBe("proto.counter");
  });

  it("logs via proto exporter", async () => {
    const logger = logs.getLogger("test");
    logger.emit({
      body: "Proto log message",
      severityNumber: 9,
      severityText: "INFO",
    });

    await vi.waitFor(async () => {
      const result = await harness.getLogs({});
      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });

    const result = await harness.getLogs({});
    const row = result.data[0];
    assertDefined(row);
    expect(row.Body).toBe("Proto log message");
  });
});

describe("clear()", () => {
  let harness: OtelTestingHarness;
  let tracerProvider: BasicTracerProvider;
  let meterProvider: MeterProvider;
  let loggerProvider: LoggerProvider;

  beforeEach(async () => {
    harness = await createOtelTestingHarness({ port: 0, host: "127.0.0.1" });

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "test-service",
    });

    tracerProvider = new BasicTracerProvider({
      resource,
      spanProcessors: [
        new SimpleSpanProcessor(
          new OTLPTraceExporter({
            url: `http://127.0.0.1:${harness.port}/v1/traces`,
          })
        ),
      ],
    });
    trace.setGlobalTracerProvider(tracerProvider);

    meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: `http://127.0.0.1:${harness.port}/v1/metrics`,
          }),
          exportIntervalMillis: 60000,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);

    loggerProvider = new LoggerProvider({
      resource,
      processors: [
        new SimpleLogRecordProcessor(
          new OTLPLogExporter({
            url: `http://127.0.0.1:${harness.port}/v1/logs`,
          })
        ),
      ],
    });
    logs.setGlobalLoggerProvider(loggerProvider);
  });

  afterEach(async () => {
    await tracerProvider.shutdown();
    await meterProvider.shutdown();
    await loggerProvider.shutdown();
    trace.disable();
    metrics.disable();
    logs.disable();
    await harness.stop();
  });

  it("clears all telemetry data", async () => {
    // Send traces
    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("clear-test-span");
    span.end();
    await tracerProvider.forceFlush();

    // Send metrics
    const meter = metrics.getMeter("test");
    const counter = meter.createCounter("clear.test.counter");
    counter.add(1);
    await meterProvider.forceFlush();

    // Send logs
    const logger = logs.getLogger("test");
    logger.emit({ body: "clear test log", severityNumber: 9 });
    await vi.waitFor(async () => {
      const result = await harness.getLogs({});
      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });

    // Verify data exists
    const traces = await harness.getTraces({});
    expect(traces.data.length).toBeGreaterThanOrEqual(1);
    const metricsResult = await harness.getMetrics({ metricType: "Sum" });
    expect(metricsResult.data.length).toBeGreaterThanOrEqual(1);

    // Clear
    await harness.clear();

    // Verify all empty
    const tracesAfter = await harness.getTraces({});
    expect(tracesAfter.data).toHaveLength(0);
    const metricsAfter = await harness.getMetrics({ metricType: "Sum" });
    expect(metricsAfter.data).toHaveLength(0);
    const logsAfter = await harness.getLogs({});
    expect(logsAfter.data).toHaveLength(0);
  });
});

describe("datasource escape hatch", () => {
  it("harness.datasource exposes TelemetryDatasource methods", async () => {
    const harness = await createOtelTestingHarness({ port: 0 });
    try {
      const ds = harness.datasource;
      expect(typeof ds.getTraces).toBe("function");
      expect(typeof ds.getLogs).toBe("function");
      expect(typeof ds.getMetrics).toBe("function");
      expect(typeof ds.discoverMetrics).toBe("function");
      expect(typeof ds.writeTraces).toBe("function");
      expect(typeof ds.writeLogs).toBe("function");
      expect(typeof ds.writeMetrics).toBe("function");
    } finally {
      await harness.stop();
    }
  });
});
