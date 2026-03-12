import { describe, it, expect, afterAll } from "@jest/globals";
import {
  createOtelTestingHarness,
  type OtelTestingHarness,
} from "@kopai/otel-testing-harness";

import { trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

describe("jest example", () => {
  let harness: OtelTestingHarness;
  let tracerProvider: BasicTracerProvider;

  afterAll(async () => {
    if (tracerProvider) {
      await tracerProvider.shutdown();
      trace.disable();
    }
    if (harness) {
      await harness.stop();
    }
  });

  it("send span and assert via getTraces()", async () => {
    harness = await createOtelTestingHarness({ port: 0, host: "127.0.0.1" });

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "jest-example",
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

    const tracer = trace.getTracer("jest-example");
    const span = tracer.startSpan("jest-span");
    span.end();

    await tracerProvider.forceFlush();

    const result = await harness.getTraces({});
    expect(result.data.length).toBeGreaterThanOrEqual(1);
    expect(result.data[0]!.SpanName).toBe("jest-span");
  });
});
