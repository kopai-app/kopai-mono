import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  dataFilterSchemas,
  denormalizedSignals,
  type datasource,
} from "@kopai/core";

export const tracesRoutes: FastifyPluginAsyncZod<{
  readTracesDatasource: datasource.ReadTracesDatasource;
}> = async function (fastify, opts) {
  fastify.route({
    method: "GET",
    url: "/signals/traces",
    schema: {
      description: "Get all spans matching a filter",
      querystring: z.object({
        filter: dataFilterSchemas.tracesDataFilterSchema,
      }),
      response: {
        200: z.array(denormalizedSignals.otelTracesSchema),
      },
    },
    handler: async (req, res) => {
      const spans = await opts.readTracesDatasource.getTraces(req.query.filter);
      res.send(spans);
    },
  });

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
      },
    },
    handler: async (req, res) => {
      const spans = await opts.readTracesDatasource.getTraces({
        traceId: req.params.traceId,
      });
      res.send(spans);
    },
  });
};
