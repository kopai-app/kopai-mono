import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import {
  decodeTracesRequest,
  decodeMetricsRequest,
  decodeLogsRequest,
  encodeTracesResponse,
  encodeMetricsResponse,
  encodeLogsResponse,
} from "./converter.js";

const PROTOBUF_CONTENT_TYPE = "application/x-protobuf";

// Store original content-type on request for response serialization
declare module "fastify" {
  interface FastifyRequest {
    originalContentType?: string;
  }
}

/**
 * Fastify plugin that adds OTLP/HTTP protobuf support.
 *
 * Per OTLP spec, the response Content-Type must match the request Content-Type.
 * This plugin:
 * 1. Adds a content-type parser for application/x-protobuf
 * 2. Decodes protobuf binary to JSON objects (with bytes→hex conversion)
 * 3. Encodes responses back to protobuf when the request was protobuf
 */
const protobufPluginImpl: FastifyPluginAsync = async (fastify) => {
  // Store original content-type before any processing
  fastify.addHook("preHandler", async (request: FastifyRequest) => {
    request.originalContentType =
      request.headers["content-type"]?.split(";")[0];
  });

  // Add protobuf content-type parser
  fastify.addContentTypeParser(
    PROTOBUF_CONTENT_TYPE,
    { parseAs: "buffer" },
    (request: FastifyRequest, payload: Buffer, done) => {
      try {
        const url = request.url;
        const buffer = new Uint8Array(payload);

        if (url.includes("/v1/traces")) {
          const decoded = decodeTracesRequest(buffer);
          done(null, decoded);
        } else if (url.includes("/v1/metrics")) {
          const decoded = decodeMetricsRequest(buffer);
          done(null, decoded);
        } else if (url.includes("/v1/logs")) {
          const decoded = decodeLogsRequest(buffer);
          done(null, decoded);
        } else {
          done(new Error(`Unknown OTLP endpoint: ${url}`), undefined);
        }
      } catch (err) {
        request.log.error(err, "Failed to decode protobuf payload");
        done(err as Error, undefined);
      }
    }
  );

  // Override response serializer to encode protobuf when needed
  // Use onSend hook which runs after serialization, allowing us to replace the payload
  fastify.addHook(
    "onSend",
    async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
      // Only handle protobuf requests
      if (request.originalContentType !== PROTOBUF_CONTENT_TYPE) {
        return payload;
      }

      // Parse the JSON payload that was serialized by Fastify
      let data: {
        partialSuccess?: {
          rejectedSpans?: string;
          rejectedDataPoints?: string;
          rejectedLogRecords?: string;
          errorMessage?: string;
        };
      };

      try {
        data = JSON.parse(payload as string);
      } catch {
        return payload;
      }

      // Set response content-type to match request (per OTLP spec)
      reply.header("content-type", PROTOBUF_CONTENT_TYPE);

      const url = request.url;

      try {
        let encoded: Uint8Array;

        if (url.includes("/v1/traces")) {
          encoded = encodeTracesResponse({
            rejectedSpans: data.partialSuccess?.rejectedSpans,
            errorMessage: data.partialSuccess?.errorMessage,
          });
        } else if (url.includes("/v1/metrics")) {
          encoded = encodeMetricsResponse({
            rejectedDataPoints: data.partialSuccess?.rejectedDataPoints,
            errorMessage: data.partialSuccess?.errorMessage,
          });
        } else if (url.includes("/v1/logs")) {
          encoded = encodeLogsResponse({
            rejectedLogRecords: data.partialSuccess?.rejectedLogRecords,
            errorMessage: data.partialSuccess?.errorMessage,
          });
        } else {
          return payload;
        }

        // Return buffer to be sent directly
        return Buffer.from(encoded);
      } catch {
        return payload;
      }
    }
  );
};

export const protobufPlugin = fp(protobufPluginImpl, {
  name: "protobuf-plugin",
});

export { PROTOBUF_CONTENT_TYPE };
