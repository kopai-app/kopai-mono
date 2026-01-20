import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { WriteMetricsDatasource } from "@kopai/core";
import { otlpMetricsZod } from "@kopai/core";

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
  writeMetricsDatasource: WriteMetricsDatasource;
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

      res.send({
        partialSuccess: {
          rejectedDataPoints,
          errorMessage,
        },
      });
    },
  });
};
