import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { collectorRoutes } from "@kopai/collector";
import type { datasource } from "@kopai/core";

export const otelCollectorRoutes: FastifyPluginAsyncZod<{
  telemetryDatasource: datasource.WriteTelemetryDatasource;
}> = async function (fastify, opts) {
  fastify.register(collectorRoutes, opts);
};
