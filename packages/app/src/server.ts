import fastify from "fastify";
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
import { uiPlugin } from "@kopai/ui";

const apiServer = fastify({
  logger: true,
});

// Add schema validator and serializer
apiServer.setValidatorCompiler(validatorCompiler);
apiServer.setSerializerCompiler(serializerCompiler);

const uiRoutes = ["/", "/dashboard", "/dashboard/*", "/api/generate"];
apiServer.register(fastifySwagger, {
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

apiServer.register(fastifySwaggerUI, {
  routePrefix: "/documentation",
  logo: {
    type: "image/svg+xml",
    content: Buffer.from(
      "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjAgNDAiIGZpbGw9Im5vbmUiPjx0ZXh0IHg9IjAiIHk9IjI4IiBmb250LWZhbWlseT0iU3BhY2UgR3JvdGVzaywgc3lzdGVtLXVpLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjI0IiBmb250LXdlaWdodD0iNzAwIiBmaWxsPSIjZmFmYWZhIj5Lb3BhaTwvdGV4dD48L3N2Zz4K",
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
          "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNCIgZmlsbD0iIzBhMGEwYSIvPjx0ZXh0IHg9IjQiIHk9IjIzIiBmb250LWZhbWlseT0ic3lzdGVtLXVpLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE4IiBmb250LXdlaWdodD0iNzAwIiBmaWxsPSIjZmFmYWZhIj5LPC90ZXh0Pjwvc3ZnPgo=",
          "base64"
        ),
      },
    ],
  },
});

const sqliteDatabase = initializeDatabase(env.SQLITE_DB_FILE_PATH);
const telemetryDatasource = createOptimizedDatasource(sqliteDatabase);

apiServer.after(() => {
  apiServer.register(apiRoutes, {
    readTelemetryDatasource: telemetryDatasource,
  });
  apiServer.register(uiPlugin);
});

const collectorServer = fastify({
  logger: true,
});

collectorServer.setValidatorCompiler(validatorCompiler);
collectorServer.setSerializerCompiler(serializerCompiler);

collectorServer.after(() => {
  collectorServer.register(otelCollectorRoutes, {
    telemetryDatasource,
  });
});

async function run() {
  console.log(`@kopai/app v${version}`);

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
