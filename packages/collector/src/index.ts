import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { datasource } from "@kopai/core";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";

import { metricsRoute } from "./routes/metrics.js";
import { tracesRoute } from "./routes/traces.js";
import { logsRoute } from "./routes/logs.js";
import { collectorErrorHandler } from "./routes/error-handler.js";

export const collectorRoutes: FastifyPluginAsyncZod<{
  telemetryDatasource: datasource.TelemetryDatasource;
}> = async function (fastify, opts) {
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.setErrorHandler(collectorErrorHandler);

  fastify.register(metricsRoute, {
    writeMetricsDatasource: opts.telemetryDatasource,
  });

  fastify.register(tracesRoute, {
    writeTracesDatasource: opts.telemetryDatasource,
  });

  fastify.register(logsRoute, {
    writeLogsDatasource: opts.telemetryDatasource,
  });
};
