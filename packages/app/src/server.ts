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
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import FastifyVite from "@fastify/vite";
import { printStartupBanner } from "./startup-banner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function hasComponentSchemas(
  doc: unknown
): doc is { components: { schemas: Record<string, object> } } {
  return (
    typeof doc === "object" &&
    doc !== null &&
    "components" in doc &&
    typeof doc.components === "object" &&
    doc.components !== null &&
    "schemas" in doc.components &&
    typeof doc.components.schemas === "object" &&
    doc.components.schemas !== null
  );
}

const apiServer = fastify({
  logger: { level: "warn" },
});

// Add schema validator and serializer
apiServer.setValidatorCompiler(validatorCompiler);
apiServer.setSerializerCompiler(serializerCompiler);

const uiRoutes = ["/", "/*"];
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
  transformObject: (input) => {
    const result = jsonSchemaTransformObject(input);
    // Fix: z.lazy() recursive schemas generate $ref to schema0
    // but fastify-type-provider-zod doesn't define it in components.
    // Inject the missing schema definition and rename schema0 → AttributeValue.
    const raw = JSON.stringify(result);
    const renamed = raw.replaceAll(
      "#/components/schemas/schema0",
      "#/components/schemas/AttributeValue"
    );
    const patched: unknown = JSON.parse(renamed);
    if (
      hasComponentSchemas(patched) &&
      !patched.components.schemas.AttributeValue
    ) {
      patched.components.schemas.AttributeValue = {
        anyOf: [
          { type: "string" },
          { type: "number" },
          { type: "boolean" },
          {
            type: "array",
            items: { $ref: "#/components/schemas/AttributeValue" },
          },
          {
            type: "object",
            additionalProperties: {
              $ref: "#/components/schemas/AttributeValue",
            },
          },
        ],
      };
    }
    return patched as ReturnType<typeof jsonSchemaTransformObject>;
  },
});

apiServer.register(fastifySwaggerUI, {
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
  logger: { level: "warn" },
});

collectorServer.setValidatorCompiler(validatorCompiler);
collectorServer.setSerializerCompiler(serializerCompiler);

collectorServer.after(() => {
  collectorServer.register(otelCollectorRoutes, {
    telemetryDatasource,
  });
});

async function run() {
  await apiServer.ready();
  await collectorServer.ready();

  const host = env.HOST || "localhost";
  const port = env.PORT;
  const collectorPort = 4318;

  await apiServer.listen({ port, host });
  await collectorServer.listen({ port: collectorPort, host });

  printStartupBanner({ host, port, collectorPort, version });

  apiServer.log.level = "info";
  collectorServer.log.level = "info";
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

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
