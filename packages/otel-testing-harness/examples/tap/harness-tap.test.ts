import t from "tap";
import { createOtelTestingHarness } from "../../src/index.js";

import { trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

t.test("tap: send span and assert via getTraces()", async (t) => {
  const harness = await createOtelTestingHarness({
    port: 0,
    host: "127.0.0.1",
  });

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "tap-example",
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

  const tracer = trace.getTracer("tap-example");
  const span = tracer.startSpan("tap-span");
  span.end();

  await tracerProvider.forceFlush();

  const result = await harness.getTraces({});
  t.ok(result.data.length >= 1, "should have at least one trace");
  t.equal(result.data[0]!.SpanName, "tap-span");

  await tracerProvider.shutdown();
  trace.disable();
  await harness.stop();
});
