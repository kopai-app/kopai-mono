import { createRequire } from "node:module";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { signalsRoutes, dashboardsRoutes } from "@kopai/api";
import { type datasource, type dashboardDatasource } from "@kopai/core";
import { mcpRoutes } from "@kopai/mcp";
import { generatePromptInstructions, observabilityCatalog } from "@kopai/ui";

import { LOOPBACK_HOSTNAMES } from "../loopback.js";

const require = createRequire(import.meta.url);
const uiPkg = require("@kopai/ui/package.json");

// The local app has no authentication, so these two lists are all that stands
// between a web page and /mcp. Host stops a DNS-rebinding page; Origin
// stops a page that simply fetches http://127.0.0.1:<port>/mcp, which arrives
// with a genuinely loopback Host. MCP clients outside a browser (Claude Code,
// curl, Node fetch) send no Origin, so they pass.
//
// NOTE the REST routes registered beside it check neither header, so a
// rebinding page can still read the same data there. That gap is pinned by a
// test in index.test.ts and tracked separately; it is not closed here.

const promptInstructions = generatePromptInstructions(
  observabilityCatalog,
  uiPkg.version
);

/**
 * Every API route the app serves, with no prefix: the signals and dashboards
 * REST routes, and the MCP endpoint at `/mcp`. All of them read the same
 * telemetry datasource.
 */
export const apiRoutes: FastifyPluginAsyncZod<{
  readTelemetryDatasource: datasource.ReadTelemetryDatasource;
  dynamicDashboardDatasource: dashboardDatasource.DynamicDashboardDatasource;
}> = async function (fastify, opts) {
  fastify.register(signalsRoutes, {
    readTelemetryDatasource: opts.readTelemetryDatasource,
  });
  fastify.register(mcpRoutes, {
    readTelemetryDatasource: opts.readTelemetryDatasource,
    allowedHosts: LOOPBACK_HOSTNAMES,
    allowedOriginHostnames: LOOPBACK_HOSTNAMES,
  });
  fastify.register(dashboardsRoutes, {
    dynamicDashboardDatasource: opts.dynamicDashboardDatasource,
    promptInstructions,
  });
};
