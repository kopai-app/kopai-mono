import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { datasource } from "@kopai/core";
import { problemDetailsSchema } from "./error-schema-zod.js";

type Fastify = Parameters<FastifyPluginAsyncZod>[0];

const rowSchema = z.record(z.string(), z.unknown());

// Single envelope: `cursor` is `string | null` for non-aggregated queries
// (next-page token or `null` on the last page) and is omitted entirely for
// aggregated queries.
const queryResponseSchema = z.object({
  rows: z.array(rowSchema),
  cursor: z.string().nullable().optional(),
});

export function registerQueryRoute<S extends z.ZodTypeAny>(
  fastify: Fastify,
  signal: "traces" | "logs" | "metrics",
  bodySchema: S,
  executor: (body: z.infer<S>) => Promise<datasource.KopaiQueryResult>
): void {
  fastify.route({
    method: "POST",
    url: `/signals/${signal}/query`,
    schema: {
      description: `Execute a typed KopaiQuery against ${signal}. Returns \`{ rows, cursor }\`; \`cursor\` is omitted for aggregated queries and is \`null\` on the last page of non-aggregated queries.`,
      body: bodySchema,
      response: {
        200: queryResponseSchema,
        "4xx": problemDetailsSchema,
        "5xx": problemDetailsSchema,
      },
    },
    handler: async (req) => {
      const result = await executor(req.body as z.infer<S>);
      if (result.isAgg) return { rows: result.rows };
      return { rows: result.rows, cursor: result.cursor };
    },
  });
}
