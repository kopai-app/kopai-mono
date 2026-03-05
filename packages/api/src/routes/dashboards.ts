import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { dashboardDatasource } from "@kopai/core";
import { problemDetailsSchema } from "./error-schema-zod.js";
import { DashboardNotFoundError } from "./errors.js";

export const dashboardsRoutes: FastifyPluginAsyncZod<{
  dynamicDashboardDatasource: dashboardDatasource.DynamicDashboardDatasource;
}> = async function (fastify, opts) {
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
        throw new DashboardNotFoundError(
          `Dashboard not found: ${req.params.dashboardId}`,
          { cause: error }
        );
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
