import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { TelemetryDatasource } from "@kopai/core";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";

import { metricsRoute } from "./routes/metrics.js";
import { collectorErrorHandler } from "./routes/error-handler.js";

export const collectorRoutes: FastifyPluginAsyncZod<{
  telemetryDatasource: TelemetryDatasource;
}> = async function (fastify, opts) {
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.setErrorHandler(collectorErrorHandler);

  fastify.register(metricsRoute, {
    writeMetricsDatasource: opts.telemetryDatasource,
  });
};
