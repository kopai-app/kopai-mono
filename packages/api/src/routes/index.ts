import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

export const apiRoutes: FastifyPluginAsyncZod<{ dbURl: string }> =
  async function (fastify, opts) {
    fastify.route({
      method: "GET",
      url: "/metrics",
      // Define your schema
      schema: {
        querystring: z.object({
          name: z.string().min(4),
        }),
        response: {
          200: z.string(),
        },
      },
      handler: (req, res) => {
        res.send(`${req.query.name}, url ${opts.dbURl}`);
      },
    });
  };
