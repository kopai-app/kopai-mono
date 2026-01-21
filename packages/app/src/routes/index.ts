import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { signalsRoutes } from "@kopai/api";
import { type datasource } from "@kopai/core";

export const apiRoutes: FastifyPluginAsyncZod<{
  readTelemetryDatasource: datasource.ReadTelemetryDatasource;
}> = async function (fastify, opts) {
  fastify.register(signalsRoutes, {
    readTelemetryDatasource: opts.readTelemetryDatasource,
  });
};
