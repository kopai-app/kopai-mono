import fastify from "fastify";
import {
  jsonSchemaTransformObject,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUI from "@fastify/swagger-ui";

import { env } from "./config.js";
import { apiRoutes } from "./routes/index.js";
import { otelCollectorRoutes } from "./collector/index.js";
import {
  initializeDatabase,
  NodeSqliteTelemetryDatasource,
} from "@kopai/sqlite-datasource";

const apiServer = fastify({
  logger: true,
});

// Add schema validator and serializer
apiServer.setValidatorCompiler(validatorCompiler);
apiServer.setSerializerCompiler(serializerCompiler);

apiServer.register(fastifySwagger, {
  openapi: {
    info: {
      title: "Kopai App",
      description: "Kopai App documentation",
      version: "1.0.0",
    },
    servers: [],
  },
  transform: jsonSchemaTransform,
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

apiServer.after(() => {
  apiServer.register(apiRoutes, {
    dbURl: "testDbUrl",
  });
});

const collectorServer = fastify({
  logger: true,
});

collectorServer.setValidatorCompiler(validatorCompiler);
collectorServer.setSerializerCompiler(serializerCompiler);

collectorServer.after(async () => {
  const sqliteDatabase = initializeDatabase(env.SQLITE_DB_FILE_PATH);
  const telemetryDatasource = new NodeSqliteTelemetryDatasource(sqliteDatabase);

  collectorServer.register(otelCollectorRoutes, {
    telemetryDatasource,
  });
});

async function run() {
  await apiServer.ready();

  const apiPort = env.PORT || 8080;

  apiServer.listen(
    {
      port: apiPort,
    },
    (err, address) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      console.log(`API server listening at ${address}`);
    }
  );

  await collectorServer.ready();

  const STANDARD_OTEL_HTTP_COLLECTOR_PORT = 4318;

  collectorServer.listen(
    {
      port: STANDARD_OTEL_HTTP_COLLECTOR_PORT,
    },
    (err, address) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      console.log(
        `OTEL collector server listening at ${address}:${STANDARD_OTEL_HTTP_COLLECTOR_PORT}`
      );
    }
  );
}

run();
