import { createRequire } from "node:module";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { signalsRoutes, dashboardsRoutes } from "@kopai/api";
import { type datasource, type dashboardDatasource } from "@kopai/core";
import { generatePromptInstructions, observabilityCatalog } from "@kopai/ui";

const require = createRequire(import.meta.url);
const uiPkg = require("@kopai/ui/package.json");

const promptInstructions = generatePromptInstructions(
  observabilityCatalog,
  uiPkg.version
);

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
