import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { otlpMetricsZod, type datasource } from "@kopai/core";
import { emitIngestionMetrics } from "./ingestion-metrics.js";

// https://github.com/open-telemetry/opentelemetry-specification/blob/49845849d2d8df07059f82033f39e96c561927cf/oteps/0122-otlp-http-json.md#response
const exportMetricsServiceResponseSchema = z.object({
  partialSuccess: z
    .object({
      rejectedDataPoints: z.string().optional(),
      errorMessage: z.string().optional(),
    })
    .optional(),
});

export const metricsRoute: FastifyPluginAsyncZod<{
  writeMetricsDatasource: datasource.WriteMetricsDatasource;
  ingestionMetricsDatasource?: datasource.WriteMetricsDatasource;
}> = async function (fastify, opts) {
  fastify.route({
    method: "POST",
    url: "/v1/metrics",
    schema: {
      body: otlpMetricsZod.metricsDataSchema,
      response: {
        200: exportMetricsServiceResponseSchema,
      },
    },
    handler: async (req, res) => {
      const { rejectedDataPoints, errorMessage } =
        await opts.writeMetricsDatasource.writeMetrics(req.body);

      if (opts.ingestionMetricsDatasource) {
        void emitIngestionMetrics(
          opts.ingestionMetricsDatasource,
          "/v1/metrics",
          req.ingestContentLength
        );
      }

      res.send({
        partialSuccess: {
          rejectedDataPoints,
          errorMessage,
        },
      });
    },
  });
};
