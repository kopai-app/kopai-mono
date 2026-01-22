import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  dataFilterSchemas,
  denormalizedSignals,
  type datasource,
} from "@kopai/core";
import { problemDetailsSchema } from "./error-schema-zod.js";

export const tracesRoutes: FastifyPluginAsyncZod<{
  readTracesDatasource: datasource.ReadTracesDatasource;
}> = async function (fastify, opts) {
  fastify.route({
    method: "GET",
    url: "/signals/traces/:traceId",
    schema: {
      description: "Get all spans for a trace by traceId",
      params: z.object({
        traceId: z.string().describe("A TraceId of the trace"),
      }),
      response: {
        200: z.array(denormalizedSignals.otelTracesSchema),
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.readTracesDatasource.getTraces({
        traceId: req.params.traceId,
      });
      res.send(result.data);
    },
  });

  const searchResponseSchema = z.object({
    data: z.array(denormalizedSignals.otelTracesSchema),
    nextCursor: z.string().nullable(),
  });

  fastify.route({
    method: "POST",
    url: "/signals/traces/search",
    schema: {
      description: "Search spans matching a filter",
      body: dataFilterSchemas.tracesDataFilterSchema,
      response: {
        200: searchResponseSchema,
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.readTracesDatasource.getTraces(req.body);
      res.send(result);
    },
  });
};
