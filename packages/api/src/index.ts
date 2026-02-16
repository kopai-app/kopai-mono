import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { type datasource } from "@kopai/core";

declare module "fastify" {
  interface FastifyRequest {
    requestContext?: unknown;
  }
}
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { errorHandler } from "./routes/error-handler.js";
import { tracesRoutes } from "./routes/traces.js";
import { logsRoutes } from "./routes/logs.js";
import { metricsRoutes } from "./routes/metrics.js";

export const signalsRoutes: FastifyPluginAsyncZod<{
  readTelemetryDatasource: datasource.ReadTelemetryDatasource;
}> = async function (fastify, opts) {
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.setErrorHandler(errorHandler);

  fastify.register(tracesRoutes, {
    readTracesDatasource: opts.readTelemetryDatasource,
  });

  fastify.register(logsRoutes, {
    readLogsDatasource: opts.readTelemetryDatasource,
  });

  fastify.register(metricsRoutes, {
    readMetricsDatasource: opts.readTelemetryDatasource,
  });
};
