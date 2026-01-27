import { create, toBinary } from "@bufbuild/protobuf";
import { ExportTraceServiceRequestSchema } from "./src/gen/opentelemetry/proto/collector/trace/v1/trace_service_pb.js";
import { decodeTracesRequest } from "./src/protobuf/converter.js";
import { Span_SpanKind } from "./src/gen/opentelemetry/proto/trace/v1/trace_pb.js";

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

const traceId = hexToBytes("0123456789abcdef0123456789abcdef");
const spanId = hexToBytes("0123456789abcdef");

const request = create(ExportTraceServiceRequestSchema, {
  resourceSpans: [
    {
      resource: {
        attributes: [
          {
            key: "service.name",
            value: { value: { case: "stringValue", value: "test-service" } },
          },
        ],
      },
      scopeSpans: [
        {
          scope: { name: "test-instrumentation" },
          spans: [
            {
              traceId,
              spanId,
              name: "test-span",
              kind: Span_SpanKind.SERVER,
              startTimeUnixNano: 1704067200000000000n,
              endTimeUnixNano: 1704067260000000000n,
            },
          ],
        },
      ],
    },
  ],
});

console.log("Created request with spans:", request.resourceSpans.length);

const payload = toBinary(ExportTraceServiceRequestSchema, request);
console.log("Payload length:", payload.length);

try {
  const decoded = decodeTracesRequest(payload);
  console.log("Decoded successfully!");
  console.log(
    "Decoded resourceSpans:",
    JSON.stringify(decoded.resourceSpans, null, 2)
  );
} catch (e) {
  console.error("Error:", e);
}
