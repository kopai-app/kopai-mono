import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { type datasource } from "@kopai/core";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { errorHandler } from "./routes/error-handler.js";
import { tracesRoutes } from "./routes/traces.js";

export const apiRoutes: FastifyPluginAsyncZod<{
  readTracesDatasource: datasource.ReadTracesDatasource;
}> = async function (fastify, opts) {
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.setErrorHandler(errorHandler);
  // TODO: errorHandler
  // TODO: tests
  fastify.register(tracesRoutes, {
    readTracesDatasource: opts.readTracesDatasource,
  });
};
