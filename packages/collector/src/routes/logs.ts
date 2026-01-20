import { z } from "zod/v4";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { otlpZod, type datasource } from "@kopai/core";

// https://github.com/open-telemetry/opentelemetry-specification/blob/49845849d2d8df07059f82033f39e96c561927cf/oteps/0122-otlp-http-json.md#response
const exportLogsServiceResponseSchema = z.object({
  partialSuccess: z
    .object({
      rejectedLogRecords: z.string().optional(),
      errorMessage: z.string().optional(),
    })
    .optional(),
});

export const logsRoute: FastifyPluginAsyncZod<{
  writeLogsDatasource: datasource.WriteLogsDatasource;
}> = async function (fastify, opts) {
  fastify.route({
    method: "POST",
    url: "/v1/logs",
    schema: {
      body: otlpZod.logsDataSchema,
      response: {
        200: exportLogsServiceResponseSchema,
      },
    },
    handler: async (req, res) => {
      const { rejectedLogRecords, errorMessage } =
        await opts.writeLogsDatasource.writeLogs(req.body);

      res.send({
        partialSuccess: {
          rejectedLogRecords,
          errorMessage,
        },
      });
    },
  });
};
