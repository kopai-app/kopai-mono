import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { z } from "zod/v4";
import { problemDetailsSchema } from "./error-schema-zod.js";
import { NotImplementedError } from "./errors.js";

type Fastify = Parameters<FastifyPluginAsyncZod>[0];

export function registerQueryRoute(
  fastify: Fastify,
  signal: "traces" | "logs" | "metrics",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bodySchema: z.ZodType<any>
): void {
  fastify.route({
    method: "POST",
    url: `/signals/${signal}/query`,
    schema: {
      description: `Execute a typed KopaiQuery against ${signal}. Schema-wired but not yet backed by a datasource (returns 501).`,
      body: bodySchema,
      response: {
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async () => {
      const capitalized = signal[0]!.toUpperCase() + signal.slice(1);
      throw new NotImplementedError(
        `${capitalized} query endpoint is not yet wired to a datasource`
      );
    },
  });
}
