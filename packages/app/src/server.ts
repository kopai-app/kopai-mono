import fastify from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  jsonSchemaTransformObject,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUI from "@fastify/swagger-ui";
import closeWithGrace from "close-with-grace";

import { env } from "./config.js";
import { version } from "./version.js";
import { apiRoutes } from "./routes/index.js";
import { otelCollectorRoutes } from "./collector/index.js";
import {
  initializeDatabase,
  createOptimizedDatasource,
} from "@kopai/sqlite-datasource";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import FastifyVite from "@fastify/vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

const baseApiServer = fastify({
  logger: true,
});

// Register swagger on base instance (its types augment FastifyTypeProviderDefault)
const uiRoutes = ["/", "/*"];
baseApiServer.register(fastifySwagger, {
  openapi: {
    info: {
      title: "Kopai App",
      description: "Kopai App documentation",
      version,
    },
    servers: [],
  },
  transform: ({ schema, url, ...rest }) => {
    if (uiRoutes.includes(url)) return { schema: { hide: true }, url };
    return jsonSchemaTransform({ schema, url, ...rest });
  },
  transformObject: jsonSchemaTransformObject,
});

baseApiServer.register(fastifySwaggerUI, {
  routePrefix: "/documentation",
  logo: {
    type: "image/svg+xml",
    content: Buffer.from(
      "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNjAgNDAiIGZpbGw9Im5vbmUiPjx0ZXh0IHg9IjAiIHk9IjI4IiBmb250LWZhbWlseT0idWktbW9ub3NwYWNlLCBtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMjAiIGZvbnQtd2VpZ2h0PSI0MDAiIGZpbGw9IiNmYWZhZmEiPnwtLWsmZ3Q7IGtvcGFpPC90ZXh0Pjwvc3ZnPg==",
      "base64"
    ),
    href: "/documentation",
    target: "_blank",
  },
  theme: {
    favicon: [
      {
        filename: "favicon.svg",
        rel: "icon",
        sizes: "32x32",
        type: "image/svg+xml",
        content: Buffer.from(
          "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNCIgZmlsbD0iIzBhMGEwYSIvPjx0ZXh0IHg9IjMiIHk9IjIyIiBmb250LWZhbWlseT0idWktbW9ub3NwYWNlLCBtb25vc3BhY2UiIGZvbnQtc2l6ZT0iMTYiIGZvbnQtd2VpZ2h0PSI0MDAiIGZpbGw9IiNmYWZhZmEiPmsmZ3Q7PC90ZXh0Pjwvc3ZnPg==",
          "base64"
        ),
      },
    ],
  },
});

// Narrow to ZodTypeProvider for route registration
const apiServer = baseApiServer.withTypeProvider<ZodTypeProvider>();
apiServer.setValidatorCompiler(validatorCompiler);
apiServer.setSerializerCompiler(serializerCompiler);

const sqliteDatabase = initializeDatabase(env.SQLITE_DB_FILE_PATH);
const telemetryDatasource = createOptimizedDatasource(sqliteDatabase);

apiServer.after(() => {
  apiServer.register(apiRoutes, {
    readTelemetryDatasource: telemetryDatasource,
  });
  apiServer.register(async (fastify) => {
    await fastify.register(FastifyVite, {
      root: resolve(__dirname, ".."),
      distDir: "dist",
      dev: false,
      spa: true,
    });
    fastify.get("/", (_req, reply) => reply.html());
    fastify.get("/*", (_req, reply) => reply.html());
    await fastify.vite.ready();
  });
});

const collectorServer = fastify({
  logger: true,
}).withTypeProvider<ZodTypeProvider>();

collectorServer.setValidatorCompiler(validatorCompiler);
collectorServer.setSerializerCompiler(serializerCompiler);

collectorServer.after(() => {
  collectorServer.register(otelCollectorRoutes, {
    telemetryDatasource,
  });
});

async function run() {
  console.log(`|--k> @kopai/app v${version}\n\n`);

  await apiServer.ready();

  const host = env.HOST || "localhost";
  const port = env.PORT;
  const STANDARD_OTEL_HTTP_COLLECTOR_PORT = 4318;

  apiServer.listen(
    {
      port,
      host,
      listenTextResolver(address) {
        return `API server listening at ${address}`;
      },
    },
    (err, address) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      apiServer.log.info(
        `API server documentation available at ${address}/documentation`
      );
    }
  );

  await collectorServer.ready();

  collectorServer.listen(
    {
      port: STANDARD_OTEL_HTTP_COLLECTOR_PORT,
      host,
      listenTextResolver(address) {
        return `OTEL collector server listening at ${address}:${STANDARD_OTEL_HTTP_COLLECTOR_PORT}`;
      },
    },
    (err) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
    }
  );
}

run();

closeWithGrace(async ({ signal, err }) => {
  if (err) {
    collectorServer.log.fatal(
      { err },
      "Closing OTEL collector server with error"
    );
    apiServer.log.fatal({ err }, "Closing API server with error");
  } else {
    collectorServer.log.info(
      `Received signal ${signal}, closing OTEL collector server`
    );
    apiServer.log.info(`Received signal ${signal}, closing API server`);
  }

  await collectorServer.close();
  sqliteDatabase?.close();
  await apiServer.close();
});
