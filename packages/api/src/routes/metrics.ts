import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  dataFilterSchemas,
  denormalizedSignals,
  type datasource,
} from "@kopai/core";

export const metricsRoutes: FastifyPluginAsyncZod<{
  readMetricsDatasource: datasource.ReadMetricsDatasource;
}> = async function (fastify, opts) {
  const searchResponseSchema = z.object({
    data: z.array(denormalizedSignals.otelMetricsSchema),
    nextCursor: z.string().nullable(),
  });

  fastify.route({
    method: "POST",
    url: "/signals/metrics/search",
    schema: {
      description: "Search metrics matching a filter",
      body: dataFilterSchemas.metricsDataFilterSchema,
      response: {
        200: searchResponseSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.readMetricsDatasource.getMetrics(req.body);
      res.send(result);
    },
  });
};
