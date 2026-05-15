import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  dataFilterSchemas,
  denormalizedSignals,
  type datasource,
} from "@kopai/core";
import { problemDetailsSchema } from "./error-schema-zod.js";

export const logsRoutes: FastifyPluginAsyncZod<{
  readLogsDatasource: datasource.ReadLogsDatasource;
}> = async function (fastify, opts) {
  const searchResponseSchema = z.object({
    data: z.array(denormalizedSignals.otelLogsSchema),
    nextCursor: z.string().nullable(),
  });

  const aggregatedResponseSchema = z.object({
    data: z.array(denormalizedSignals.aggregatedLogSchema),
    nextCursor: z.null(),
  });

  fastify.route({
    method: "POST",
    url: "/signals/logs/search",
    schema: {
      description: "Search logs matching a filter",
      body: dataFilterSchemas.logsDataFilterSchema,
      response: {
        200: z.union([searchResponseSchema, aggregatedResponseSchema]),
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      const params = { ...req.body, requestContext: req.requestContext };
      const result = req.body.aggregate
        ? await opts.readLogsDatasource.getAggregatedLogs(params)
        : await opts.readLogsDatasource.getLogs(params);
      res.send(result);
    },
  });
};
