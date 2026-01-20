import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { collectorRoutes } from "@kopai/collector";
import type { datasource } from "@kopai/core";

export const otelCollectorRoutes: FastifyPluginAsyncZod<{
  telemetryDatasource: datasource.TelemetryDatasource;
}> = async function (fastify, opts) {
  fastify.register(collectorRoutes, opts);
};
