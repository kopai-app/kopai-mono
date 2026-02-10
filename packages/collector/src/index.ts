import { createGunzip } from "node:zlib";
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
import { protobufPlugin } from "./protobuf/index.js";

export const collectorRoutes: FastifyPluginAsyncZod<{
  telemetryDatasource: datasource.WriteTelemetryDatasource;
}> = async function (fastify, opts) {
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.setErrorHandler(collectorErrorHandler);

  // Decompress gzip request bodies (OTLP/HTTP defaults to gzip compression).
  // Fastify's default bodyLimit (1 MiB) applies to the decoded payload,
  // which implicitly caps decompression size and protects against decompression bombs.
  fastify.addHook("preParsing", async (request, _reply, payload) => {
    const encoding = request.headers["content-encoding"];
    if (encoding === "gzip" || encoding === "x-gzip") {
      const contentLength = request.headers["content-length"];
      delete request.headers["content-encoding"];
      delete request.headers["content-length"];
      const decompressed = payload.pipe(createGunzip());
      if (contentLength) {
        Object.assign(decompressed, {
          receivedEncodedLength: parseInt(contentLength, 10),
        });
      }
      return decompressed;
    }
    return payload;
  });

  // Register protobuf support (OTLP/HTTP with application/x-protobuf)
  fastify.register(protobufPlugin);

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
