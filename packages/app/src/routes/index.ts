import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { apiRoutes as kopaiApiRoutes } from "@kopai/api";

export const apiRoutes: FastifyPluginAsyncZod<{ dbURl: string }> =
  async function (fastify, opts) {
    fastify.register(kopaiApiRoutes, {
      dbURl: opts.dbURl,
    });
  };
