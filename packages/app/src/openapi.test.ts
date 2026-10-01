/// <reference types="vitest/globals" />
import fastifySwagger from "@fastify/swagger";
import {
  createOptimizedDatasource,
  DashboardDbDatasource,
  initializeDatabase,
} from "@kopai/sqlite-datasource";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { DatabaseSync } from "node:sqlite";

import { createOpenapiTransform } from "./openapi.js";
import { apiRoutes } from "./routes/index.js";

let connection: DatabaseSync;
let app: FastifyInstance;

beforeEach(async () => {
  connection = initializeDatabase(":memory:");
  app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(fastifySwagger, {
    openapi: { info: { title: "t", version: "0" } },
    transform: createOpenapiTransform({ host: "localhost", port: 8123 }),
  });
  await app.register(apiRoutes, {
    readTelemetryDatasource: createOptimizedDatasource(connection),
    dynamicDashboardDatasource: new DashboardDbDatasource(connection),
  });
  app.get("/", async () => "");
  app.get("/*", async () => "");
  await app.ready();
});

afterEach(async () => {
  await app.close();
  connection.close();
});

describe("the OpenAPI document", () => {
  it("lists POST /mcp with how to connect, at the port the app runs on", () => {
    const post = app.swagger().paths?.["/mcp"]?.post;
    expect(post?.summary).toMatch(/MCP/);
    expect(post?.description).toContain(
      "claude mcp add --transport http local-kopai http://localhost:8123/mcp"
    );
  });

  // GET and DELETE exist only so the SDK can answer them 405.
  it("hides the GET and DELETE /mcp routes", () => {
    const mcp = app.swagger().paths?.["/mcp"];
    expect(mcp).not.toHaveProperty("get");
    expect(mcp).not.toHaveProperty("delete");
  });

  // Bound to one LAN address the banner says MCP is unavailable; the docs must
  // not hand out a localhost URL that nothing listens on.
  it("says MCP is unavailable when bound to a specific non-loopback address", async () => {
    const lan = Fastify({ logger: false });
    lan.setValidatorCompiler(validatorCompiler);
    lan.setSerializerCompiler(serializerCompiler);
    await lan.register(fastifySwagger, {
      openapi: { info: { title: "t", version: "0" } },
      transform: createOpenapiTransform({ host: "192.168.1.5", port: 8123 }),
    });
    await lan.register(apiRoutes, {
      readTelemetryDatasource: createOptimizedDatasource(connection),
      dynamicDashboardDatasource: new DashboardDbDatasource(connection),
    });
    await lan.ready();
    const description = lan.swagger().paths?.["/mcp"]?.post?.description;
    await lan.close();
    expect(description).not.toContain("claude mcp add");
    expect(description).toContain("Unavailable");
    expect(description).toContain("bind HOST to localhost");
  });

  it("still hides the UI routes and still documents the signals routes", () => {
    const paths = app.swagger().paths ?? {};
    expect(paths).not.toHaveProperty("/");
    expect(paths).not.toHaveProperty("/*");
    expect(paths).toHaveProperty("/signals/traces/search");
  });
});
