import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { WriteMetricsDatasource } from "@kopai/core";

import { metricsRoute } from "./routes/metrics.js";
import { collectorErrorHandler } from "./routes/error-handler.js";

export const apiRoutes: FastifyPluginAsyncZod<{
  writeMetricsDatasource: WriteMetricsDatasource;
}> = async function (fastify, opts) {
  fastify.setErrorHandler(collectorErrorHandler);

  fastify.register(metricsRoute, {
    writeMetricsDatasource: opts.writeMetricsDatasource,
  });
};
