/// <reference types="vitest/globals" />
import fastify, { type FastifyInstance } from "fastify";
import { collectorRoutes } from "./index.js";
import type { datasource } from "@kopai/core";

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

describe("collector integration", () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let writeMetricsSpy: ReturnType<
    typeof vi.fn<
      (
        metricsData: datasource.MetricsData
      ) => Promise<datasource.MetricsPartialSuccess>
    >
  >;
  let writeTracesSpy: ReturnType<
    typeof vi.fn<
      (
        tracesData: datasource.TracesData
      ) => Promise<datasource.TracesPartialSuccess>
    >
  >;
  let writeLogsSpy: ReturnType<
    typeof vi.fn<
      (logsData: datasource.LogsData) => Promise<datasource.LogsPartialSuccess>
    >
  >;
  let tracerProvider: BasicTracerProvider;
  let meterProvider: MeterProvider;
  let loggerProvider: LoggerProvider;

  beforeEach(async () => {
    writeMetricsSpy = vi.fn().mockResolvedValue({
      rejectedDataPoints: undefined,
      errorMessage: undefined,
    });
    writeTracesSpy = vi.fn().mockResolvedValue({
      rejectedSpans: undefined,
      errorMessage: undefined,
    });
    writeLogsSpy = vi.fn().mockResolvedValue({
      rejectedLogRecords: undefined,
      errorMessage: undefined,
    });

    server = fastify();
    server.register(collectorRoutes, {
      telemetryDatasource: {
        writeMetrics: writeMetricsSpy,
        writeTraces: writeTracesSpy,
        writeLogs: writeLogsSpy,
      },
    });

    await server.listen({ port: 0, host: "127.0.0.1" });
    const addr = server.addresses()[0]!;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "integration-test-service",
    });

    // Setup trace provider
    tracerProvider = new BasicTracerProvider({
      resource,
      spanProcessors: [
        new SimpleSpanProcessor(
          new OTLPTraceExporter({
            url: `${baseUrl}/v1/traces`,
          })
        ),
      ],
    });
    trace.setGlobalTracerProvider(tracerProvider);

    // Setup meter provider
    meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: `${baseUrl}/v1/metrics`,
          }),
          exportIntervalMillis: 60000, // long interval, we'll forceFlush
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);

    // Setup logger provider
    loggerProvider = new LoggerProvider({
      resource,
      processors: [
        new SimpleLogRecordProcessor(
          new OTLPLogExporter({
            url: `${baseUrl}/v1/logs`,
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

    await server.close();
  });

  it("receives traces from OTEL SDK", async () => {
    const tracer = trace.getTracer("integration-test");
    const span = tracer.startSpan("test-span");
    span.setAttribute("test.attr", "value");
    span.end();

    await tracerProvider.forceFlush();

    expect(writeTracesSpy).toHaveBeenCalled();
    const call = writeTracesSpy.mock.calls[0]![0];
    expect(call.resourceSpans!).toHaveLength(1);
    expect(call.resourceSpans![0]!.scopeSpans![0]!.spans![0]!.name).toBe(
      "test-span"
    );
  });

  it("receives metrics from OTEL SDK", async () => {
    const meter = metrics.getMeter("integration-test");
    const counter = meter.createCounter("test.counter");
    counter.add(1, { "test.attr": "value" });

    await meterProvider.forceFlush();

    expect(writeMetricsSpy).toHaveBeenCalled();
    const call = writeMetricsSpy.mock.calls[0]![0];
    expect(call.resourceMetrics!).toHaveLength(1);
    expect(call.resourceMetrics![0]!.scopeMetrics![0]!.metrics![0]!.name).toBe(
      "test.counter"
    );
  });

  it("receives logs from OTEL SDK", async () => {
    const logger = logs.getLogger("integration-test");
    logger.emit({
      body: "Test log message",
      severityNumber: 9, // INFO
      severityText: "INFO",
    });

    // Small delay to allow log processor to complete
    await new Promise((r) => setTimeout(r, 50));
    await loggerProvider.forceFlush();

    expect(writeLogsSpy).toHaveBeenCalled();
    const call = writeLogsSpy.mock.calls[0]![0];
    expect(call.resourceLogs!).toHaveLength(1);
    expect(
      call.resourceLogs![0]!.scopeLogs![0]!.logRecords![0]!.body!.stringValue
    ).toBe("Test log message");
  });
});

describe("collector integration (protobuf)", () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let writeMetricsSpy: ReturnType<
    typeof vi.fn<
      (
        metricsData: datasource.MetricsData
      ) => Promise<datasource.MetricsPartialSuccess>
    >
  >;
  let writeTracesSpy: ReturnType<
    typeof vi.fn<
      (
        tracesData: datasource.TracesData
      ) => Promise<datasource.TracesPartialSuccess>
    >
  >;
  let writeLogsSpy: ReturnType<
    typeof vi.fn<
      (logsData: datasource.LogsData) => Promise<datasource.LogsPartialSuccess>
    >
  >;
  let tracerProvider: BasicTracerProvider;
  let meterProvider: MeterProvider;
  let loggerProvider: LoggerProvider;

  beforeEach(async () => {
    writeMetricsSpy = vi.fn().mockResolvedValue({
      rejectedDataPoints: undefined,
      errorMessage: undefined,
    });
    writeTracesSpy = vi.fn().mockResolvedValue({
      rejectedSpans: undefined,
      errorMessage: undefined,
    });
    writeLogsSpy = vi.fn().mockResolvedValue({
      rejectedLogRecords: undefined,
      errorMessage: undefined,
    });

    server = fastify();
    server.register(collectorRoutes, {
      telemetryDatasource: {
        writeMetrics: writeMetricsSpy,
        writeTraces: writeTracesSpy,
        writeLogs: writeLogsSpy,
      },
    });

    await server.listen({ port: 0, host: "127.0.0.1" });
    const addr = server.addresses()[0]!;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "integration-test-service",
    });

    // Setup trace provider with proto exporter
    tracerProvider = new BasicTracerProvider({
      resource,
      spanProcessors: [
        new SimpleSpanProcessor(
          new OTLPTraceExporterProto({
            url: `${baseUrl}/v1/traces`,
          })
        ),
      ],
    });
    trace.setGlobalTracerProvider(tracerProvider);

    // Setup meter provider with proto exporter
    meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporterProto({
            url: `${baseUrl}/v1/metrics`,
          }),
          exportIntervalMillis: 60000, // long interval, we'll forceFlush
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);

    // Setup logger provider with proto exporter
    loggerProvider = new LoggerProvider({
      resource,
      processors: [
        new SimpleLogRecordProcessor(
          new OTLPLogExporterProto({
            url: `${baseUrl}/v1/logs`,
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

    await server.close();
  });

  it("receives traces from OTEL SDK", async () => {
    const tracer = trace.getTracer("integration-test");
    const span = tracer.startSpan("test-span");
    span.setAttribute("test.attr", "value");
    span.end();

    await tracerProvider.forceFlush();

    expect(writeTracesSpy).toHaveBeenCalled();
    const call = writeTracesSpy.mock.calls[0]![0];
    expect(call.resourceSpans!).toHaveLength(1);
    expect(call.resourceSpans![0]!.scopeSpans![0]!.spans![0]!.name).toBe(
      "test-span"
    );
  });

  it("receives metrics from OTEL SDK", async () => {
    const meter = metrics.getMeter("integration-test");
    const counter = meter.createCounter("test.counter");
    counter.add(1, { "test.attr": "value" });

    await meterProvider.forceFlush();

    expect(writeMetricsSpy).toHaveBeenCalled();
    const call = writeMetricsSpy.mock.calls[0]![0];
    expect(call.resourceMetrics!).toHaveLength(1);
    expect(call.resourceMetrics![0]!.scopeMetrics![0]!.metrics![0]!.name).toBe(
      "test.counter"
    );
  });

  it("receives logs from OTEL SDK", async () => {
    const logger = logs.getLogger("integration-test");
    logger.emit({
      body: "Test log message",
      severityNumber: 9, // INFO
      severityText: "INFO",
    });

    // Small delay to allow log processor to complete
    await new Promise((r) => setTimeout(r, 50));
    await loggerProvider.forceFlush();

    expect(writeLogsSpy).toHaveBeenCalled();
    const call = writeLogsSpy.mock.calls[0]![0];
    expect(call.resourceLogs!).toHaveLength(1);
    expect(
      call.resourceLogs![0]!.scopeLogs![0]!.logRecords![0]!.body!.stringValue
    ).toBe("Test log message");
  });
});
