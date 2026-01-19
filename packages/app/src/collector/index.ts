import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { apiRoutes as collectorRoutes } from "@kopai/collector";

export const otelCollectorRoutes: FastifyPluginAsyncZod<{ dbURl: string }> =
  async function (fastify, opts) {
    fastify.register(collectorRoutes, {
      // this is a console.log implementation of WriteMetricsDatasource
      writeMetricsDatasource: {
        async writeMetrics(metricsData) {
          console.log(JSON.stringify(metricsData));

          return {};
        },
      },
    });
  };
