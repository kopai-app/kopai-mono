import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  dataFilterSchemas,
  denormalizedSignals,
  type datasource,
} from "@kopai/core";

export const logsRoutes: FastifyPluginAsyncZod<{
  readLogsDatasource: datasource.ReadLogsDatasource;
}> = async function (fastify, opts) {
  const searchResponseSchema = z.object({
    data: z.array(denormalizedSignals.otelLogsSchema),
    nextCursor: z.string().nullable(),
  });

  fastify.route({
    method: "POST",
    url: "/signals/logs/search",
    schema: {
      description: "Search logs matching a filter",
      body: dataFilterSchemas.logsDataFilterSchema,
      response: {
        200: searchResponseSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.readLogsDatasource.getLogs(req.body);
      res.send(result);
    },
  });
};
