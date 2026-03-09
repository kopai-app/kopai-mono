import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { dashboardDatasource } from "@kopai/core";
import { problemDetailsSchema } from "./error-schema-zod.js";
import { DashboardNotFoundError } from "./errors.js";

export const dashboardsRoutes: FastifyPluginAsyncZod<{
  dynamicDashboardDatasource: dashboardDatasource.DynamicDashboardDatasource;
  promptInstructions?: string;
}> = async function (fastify, opts) {
  fastify.route({
    method: "GET",
    url: "/dashboards/schema",
    schema: {
      description:
        "Get UI tree schema as markdown prompt instructions for AI agents",
      produces: ["text/markdown"],
      response: {
        200: { type: "string", description: "Markdown prompt instructions" },
        404: {
          type: "string",
          description: "Prompt instructions not configured",
        },
      },
    },
    handler: async (_req, reply) => {
      if (!opts.promptInstructions) {
        return reply.status(404).send("Dashboard schema not configured");
      }
      reply.type("text/markdown").send(opts.promptInstructions);
    },
  });

  fastify.route({
    method: "POST",
    url: "/dashboards",
    schema: {
      description: "Create a dashboard containing a uiTree",
      body: dashboardDatasource.createDashboardParams,
      response: {
        201: dashboardDatasource.dashboardSchema,
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.dynamicDashboardDatasource.createDashboard({
        ...req.body,
        requestContext: req.requestContext,
      });
      res.status(201).send(result);
    },
  });

  fastify.route({
    method: "GET",
    url: "/dashboards/:dashboardId",
    schema: {
      description: "Get a dashboard containing a uiTree to be rendered",
      params: z.object({
        dashboardId: z.string(),
      }),
      response: {
        200: dashboardDatasource.dashboardSchema,
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      try {
        const result = await opts.dynamicDashboardDatasource.getDashboard({
          id: req.params.dashboardId,
          requestContext: req.requestContext,
        });
        res.send(result);
      } catch (error) {
        const msg = error instanceof Error ? error.message.toLowerCase() : "";
        if (msg.includes("not found")) {
          throw new DashboardNotFoundError(
            `Dashboard not found: ${req.params.dashboardId}`,
            { cause: error }
          );
        }
        throw error;
      }
    },
  });

  const searchResponseSchema = z.object({
    data: z.array(dashboardDatasource.dashboardSchema),
    nextCursor: z.string().nullable(),
  });

  fastify.route({
    method: "POST",
    url: "/dashboards/search",
    schema: {
      description: "Search dashboards matching a filter",
      body: dashboardDatasource.searchDashboardsFilter,
      response: {
        200: searchResponseSchema,
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req, res) => {
      const result = await opts.dynamicDashboardDatasource.searchDashboards({
        ...req.body,
        requestContext: req.requestContext,
      });
      res.send(result);
    },
  });
};
