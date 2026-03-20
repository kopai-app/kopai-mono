import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { otlpZod, type datasource } from "@kopai/core";
import { emitIngestionMetrics } from "./ingestion-metrics.js";

// https://github.com/open-telemetry/opentelemetry-specification/blob/49845849d2d8df07059f82033f39e96c561927cf/oteps/0122-otlp-http-json.md#response
const exportTracesServiceResponseSchema = z.object({
  partialSuccess: z
    .object({
      rejectedSpans: z.string().optional(),
      errorMessage: z.string().optional(),
    })
    .optional(),
});

export const tracesRoute: FastifyPluginAsyncZod<{
  writeTracesDatasource: datasource.WriteTracesDatasource;
  ingestionMetricsDatasource?: datasource.WriteMetricsDatasource;
}> = async function (fastify, opts) {
  fastify.route({
    method: "POST",
    url: "/v1/traces",
    schema: {
      body: otlpZod.tracesDataSchema,
      response: {
        200: exportTracesServiceResponseSchema,
      },
    },
    handler: async (req, res) => {
      const { rejectedSpans, errorMessage } =
        await opts.writeTracesDatasource.writeTraces(req.body);

      if (opts.ingestionMetricsDatasource) {
        void emitIngestionMetrics(
          opts.ingestionMetricsDatasource,
          "/v1/traces",
          req.ingestContentLength
        );
      }

      res.send({
        partialSuccess: {
          rejectedSpans,
          errorMessage,
        },
      });
    },
  });
};
