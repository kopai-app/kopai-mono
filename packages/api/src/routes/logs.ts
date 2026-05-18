import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  dataFilterSchemas,
  denormalizedSignals,
  logsKopaiQuerySchema,
  type datasource,
} from "@kopai/core";
import { problemDetailsSchema } from "./error-schema-zod.js";
import { NotImplementedError } from "./errors.js";

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
    url: "/signals/logs/query",
    schema: {
      description:
        "Execute a typed KopaiQuery against logs. Schema-wired but not yet backed by a datasource (returns 501).",
      body: logsKopaiQuerySchema,
      response: {
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async () => {
      throw new NotImplementedError(
        "Logs query endpoint is not yet wired to a datasource"
      );
    },
  });
};
