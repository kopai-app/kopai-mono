import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { signalsRoutes, dashboardsRoutes } from "@kopai/api";
import { type datasource, type dashboardDatasource } from "@kopai/core";
import { generatePromptInstructions, observabilityCatalog } from "@kopai/ui";

const promptInstructions = generatePromptInstructions(observabilityCatalog);

export const apiRoutes: FastifyPluginAsyncZod<{
  readTelemetryDatasource: datasource.ReadTelemetryDatasource;
  dynamicDashboardDatasource: dashboardDatasource.DynamicDashboardDatasource;
}> = async function (fastify, opts) {
  fastify.register(signalsRoutes, {
    readTelemetryDatasource: opts.readTelemetryDatasource,
  });
  fastify.register(dashboardsRoutes, {
    dynamicDashboardDatasource: opts.dynamicDashboardDatasource,
    promptInstructions,
  });
};
