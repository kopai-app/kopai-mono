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

  const aggregateBodySchema = dataFilterSchemas.logsDataFilterSchema
    .refine((d) => d.aggregate !== undefined, {
      message: "aggregate is required for /aggregate endpoint",
      path: ["aggregate"],
    })
    .refine((d) => d.groupBy !== undefined && d.groupBy.length > 0, {
      message: "groupBy is required for /aggregate endpoint",
      path: ["groupBy"],
    });

  fastify.route({
    method: "POST",
    url: "/signals/logs/search",
    schema: {
      description: "Search logs matching a filter",
      body: dataFilterSchemas.logsDataFilterSchema,
      response: {
        200: searchResponseSchema,
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.readLogsDatasource.getLogs({
        ...req.body,
        requestContext: req.requestContext,
      });
      res.send(result);
    },
  });

  fastify.route({
    method: "POST",
    url: "/signals/logs/aggregate",
    schema: {
      description:
        "Aggregate logs matching a filter (requires aggregate + groupBy)",
      body: aggregateBodySchema,
      response: {
        200: aggregatedResponseSchema,
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.readLogsDatasource.getAggregatedLogs({
        ...req.body,
        requestContext: req.requestContext,
      });
      res.send(result);
    },
  });
};
