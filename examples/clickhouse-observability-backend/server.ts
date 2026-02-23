import fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { signalsRoutes } from "@kopai/api";
import {
  ClickHouseReadDatasource,
  type ClickHouseRequestContext,
} from "@kopai/clickhouse-datasource";

const CH_BASE_URL = process.env["CH_BASE_URL"] ?? "http://localhost:8123";
const CH_DATABASE = process.env["CH_DATABASE"] ?? "otel_default";
const CH_USERNAME = process.env["CH_USERNAME"] ?? "default";
const CH_PASSWORD = process.env["CH_PASSWORD"] ?? "";
const PORT = Number(process.env["PORT"] ?? "8000");

const ds = new ClickHouseReadDatasource(CH_BASE_URL);

const requestContext: ClickHouseRequestContext = {
  database: CH_DATABASE,
  username: CH_USERNAME,
  password: CH_PASSWORD,
};

const server = fastify({ logger: true });

server.setValidatorCompiler(validatorCompiler);
server.setSerializerCompiler(serializerCompiler);

// Inject requestContext on every request
server.addHook("onRequest", async (req) => {
  req.requestContext = requestContext;
});

server.register(signalsRoutes, {
  readTelemetryDatasource: ds,
});

async function run() {
  await server.listen({ port: PORT, host: "0.0.0.0" });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await server.close();
  await ds.close();
});
