import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  dataFilterSchemas,
  denormalizedSignals,
  type datasource,
} from "@kopai/core";
import { problemDetailsSchema } from "./error-schema-zod.js";

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
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.readMetricsDatasource.getMetrics({
        ...req.body,
        requestContext: req.requestContext,
      });
      res.send(result);
    },
  });

  fastify.route({
    method: "GET",
    url: "/signals/metrics/discover",
    schema: {
      description: "Discover available metrics and their attributes",
      response: {
        200: metricsDiscoveryResponseSchema,
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.readMetricsDatasource.discoverMetrics({
        requestContext: req.requestContext,
      });
      res.send(result);
    },
  });
};

const metricTypeSchema = z.enum([
  "Gauge",
  "Sum",
  "Histogram",
  "ExponentialHistogram",
  "Summary",
]);

const discoveredAttributesSchema = z.object({
  values: z
    .record(z.string(), z.array(z.string()))
    .describe("Attribute key/value pairs. Max 100 values per key."),
  _truncated: z
    .boolean()
    .optional()
    .describe("True if any attribute key exceeded 100 values."),
});

const discoveredMetricSchema = z.object({
  name: z.string().describe("Metric name from MetricName field."),
  type: metricTypeSchema.describe(
    "Metric type: Gauge, Sum, Histogram, ExponentialHistogram, or Summary."
  ),
  unit: z.string().optional().describe("Metric unit from MetricUnit field."),
  description: z
    .string()
    .optional()
    .describe("Metric description from MetricDescription field."),
  attributes: discoveredAttributesSchema.describe(
    "Data point attributes aggregated across all data points."
  ),
  resourceAttributes: discoveredAttributesSchema.describe(
    "Resource attributes aggregated across all data points."
  ),
});

const metricsDiscoveryResponseSchema = z.object({
  metrics: z.array(discoveredMetricSchema),
});
