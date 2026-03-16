import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  createOtelTestingHarness,
  type OtelTestingHarness,
} from "../../src/index.js";

import { trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

describe("node:test example", () => {
  let harness: OtelTestingHarness;
  let tracerProvider: BasicTracerProvider;

  after(async () => {
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
      [ATTR_SERVICE_NAME]: "node-test-example",
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

    const tracer = trace.getTracer("node-test-example");
    const span = tracer.startSpan("node-test-span");
    span.end();

    await tracerProvider.forceFlush();

    const result = await harness.getTraces({});
    assert.ok(result.data.length >= 1, "should have at least one trace");
    assert.equal(result.data[0]!.SpanName, "node-test-span");
  });
});
