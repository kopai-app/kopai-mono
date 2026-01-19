import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { apiRoutes as collectorRoutes } from "@kopai/collector";
import type { TelemetryDatasource } from "@kopai/core";

export const otelCollectorRoutes: FastifyPluginAsyncZod<{
  telemetryDatasource: TelemetryDatasource;
}> = async function (fastify, opts) {
  fastify.register(collectorRoutes, opts);
};
