import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { denormalizedSignals, kopaiQuery, type datasource } from "@kopai/core";
import { problemDetailsSchema } from "./error-schema-zod.js";

// Aggregate-row response shape: dynamic dimension/measure keys. Mirrors
// the SDK's `aggregateResponseSchema` so the two stay in lock-step.
const aggregateResponseSchema = z.object({
  data: z.array(
    z.record(z.string(), z.union([z.string(), z.number(), z.null()]))
  ),
});

const tracesRawResponseSchema = z.object({
  data: z.array(denormalizedSignals.otelTracesSchema),
  nextCursor: z.string().nullable(),
});

const logsRawResponseSchema = z.object({
  data: z.array(denormalizedSignals.otelLogsSchema),
  nextCursor: z.string().nullable(),
});

const metricsRawResponseSchema = z.object({
  data: z.array(denormalizedSignals.otelMetricsSchema),
  nextCursor: z.string().nullable(),
});

export const queryRoutes: FastifyPluginAsyncZod<{
  readQueryDatasource: datasource.ReadQueryDatasource;
}> = async function (fastify, opts) {
  fastify.route({
    method: "POST",
    url: "/signals/query/traces/raw",
    schema: {
      description:
        "Run a raw trace query (KopaiQuery). Returns denormalized span rows.",
      body: kopaiQuery.TraceRawQuerySchema,
      response: {
        200: tracesRawResponseSchema,
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.readQueryDatasource.queryTracesRaw({
        ...req.body,
        requestContext: req.requestContext,
      });
      res.send(result);
    },
  });

  fastify.route({
    method: "POST",
    url: "/signals/query/traces/aggregate",
    schema: {
      description:
        "Run an aggregate trace query (KopaiQuery). Returns grouped rows.",
      body: kopaiQuery.TraceAggregateQuerySchema,
      response: {
        200: aggregateResponseSchema,
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.readQueryDatasource.queryTracesAggregate({
        ...req.body,
        requestContext: req.requestContext,
      });
      res.send(result);
    },
  });

  fastify.route({
    method: "POST",
    url: "/signals/query/logs/raw",
    schema: {
      description:
        "Run a raw log query (KopaiQuery). Returns denormalized log rows.",
      body: kopaiQuery.LogRawQuerySchema,
      response: {
        200: logsRawResponseSchema,
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.readQueryDatasource.queryLogsRaw({
        ...req.body,
        requestContext: req.requestContext,
      });
      res.send(result);
    },
  });

  fastify.route({
    method: "POST",
    url: "/signals/query/logs/aggregate",
    schema: {
      description:
        "Run an aggregate log query (KopaiQuery). Returns grouped rows.",
      body: kopaiQuery.LogAggregateQuerySchema,
      response: {
        200: aggregateResponseSchema,
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.readQueryDatasource.queryLogsAggregate({
        ...req.body,
        requestContext: req.requestContext,
      });
      res.send(result);
    },
  });

  fastify.route({
    method: "POST",
    url: "/signals/query/metrics/raw",
    schema: {
      description:
        "Run a raw metric query (KopaiQuery). Returns denormalized data-point rows.",
      body: kopaiQuery.MetricRawQuerySchema,
      response: {
        200: metricsRawResponseSchema,
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.readQueryDatasource.queryMetricsRaw({
        ...req.body,
        requestContext: req.requestContext,
      });
      res.send(result);
    },
  });

  fastify.route({
    method: "POST",
    url: "/signals/query/metrics/aggregate",
    schema: {
      description:
        "Run an aggregate metric query (KopaiQuery). Returns grouped rows.",
      body: kopaiQuery.MetricAggregateQuerySchema,
      response: {
        200: aggregateResponseSchema,
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.readQueryDatasource.queryMetricsAggregate({
        ...req.body,
        requestContext: req.requestContext,
      });
      res.send(result);
    },
  });
};
