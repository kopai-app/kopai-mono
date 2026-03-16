/// <reference types="vitest/globals" />
import { createOtelTestingHarness } from "../../src/index.js";

import { trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

it("vitest: send span and assert via getTraces()", async () => {
  const harness = await createOtelTestingHarness({
    port: 0,
    host: "127.0.0.1",
  });

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "vitest-example",
  });

  const tracerProvider = new BasicTracerProvider({
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

  const tracer = trace.getTracer("vitest-example");
  const span = tracer.startSpan("vitest-span");
  span.end();

  await tracerProvider.forceFlush();

  const result = await harness.getTraces({});
  expect(result.data.length).toBeGreaterThanOrEqual(1);
  expect(result.data[0]!.SpanName).toBe("vitest-span");

  await tracerProvider.shutdown();
  trace.disable();
  await harness.stop();
});
