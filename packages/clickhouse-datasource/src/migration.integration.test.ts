import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  GenericContainer,
  Network,
  Wait,
  type StartedTestContainer,
  type StartedNetwork,
} from "testcontainers";
import { ClickHouseReadDatasource } from "./datasource.js";
import {
  CLICKHOUSE_IMAGE,
  OTEL_COLLECTOR_VERSION_OLD,
  OTEL_COLLECTOR_VERSION,
  CH_DATABASE,
  CH_USERNAME,
  CH_PASSWORD,
  CH_HTTP_PORT,
  CH_NATIVE_PORT,
  OTEL_HTTP_PORT,
  OTEL_HEALTH_PORT,
} from "./test/constants.js";
import { createOtelCollectorConfig } from "./test/otel-collector-config.js";
import {
  createLogsPayload,
  createLogsPayloadWithEventName,
  TEST_SERVICE_NAME,
  TEST_EVENT_NAME,
  TEST_EVENT_SERVICE_NAME,
} from "./test/otel-payloads.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const CONTAINER_STARTUP_TIMEOUT = 120_000;
const DATA_SETTLE_TIMEOUT = 15_000;
const DATA_POLL_INTERVAL = 1_000;

const MIGRATIONS_DIR = path.resolve(dirname, "..", "migrations");

/**
 * Read and execute a migration SQL file, simulating the documented workflow:
 *   clickhouse-client --database=otel_default < migration.sql
 *
 * The client is created with the target database set (equivalent to --database),
 * so the SQL file does not need to qualify table names.
 */
async function runMigrationFile(
  filename: string,
  baseUrl: string
): Promise<void> {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const sql = await fs.readFile(filePath, "utf-8");

  // Create a client with the database context set, like --database flag
  const migrationClient = createClient({
    url: baseUrl,
    username: CH_USERNAME,
    password: CH_PASSWORD,
    database: CH_DATABASE,
  });

  try {
    // Execute each non-comment, non-empty statement
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter(
        (s) =>
          s.length > 0 &&
          !s
            .split("\n")
            .every((l) => l.trim().startsWith("--") || l.trim() === "")
      );

    for (const stmt of statements) {
      await migrationClient.command({ query: stmt });
    }
  } finally {
    await migrationClient.close();
  }
}

function requestContext() {
  return {
    database: CH_DATABASE,
    username: CH_USERNAME,
    password: CH_PASSWORD,
  };
}

async function waitForData(
  check: () => Promise<boolean>,
  timeoutMs = DATA_SETTLE_TIMEOUT
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await check()) return;
    } catch {
      // Swallow transient errors (e.g. table not yet created) and keep polling
    }
    await new Promise((r) => setTimeout(r, DATA_POLL_INTERVAL));
  }
  throw new Error(`Timed out waiting for data after ${String(timeoutMs)}ms`);
}

async function startCollector(
  version: string,
  network: StartedNetwork,
  configPath: string
): Promise<StartedTestContainer> {
  const image = `otel/opentelemetry-collector-contrib:${version}`;
  return new GenericContainer(image)
    .withNetwork(network)
    .withNetworkAliases("otel-collector")
    .withExposedPorts(OTEL_HTTP_PORT, OTEL_HEALTH_PORT)
    .withBindMounts([
      { source: configPath, target: "/etc/otel/config.yaml", mode: "ro" },
    ])
    .withCommand(["--config=/etc/otel/config.yaml"])
    .withWaitStrategy(Wait.forHttp("/health", OTEL_HEALTH_PORT))
    .start();
}

async function sendOtlp(
  baseUrl: string,
  endpoint: string,
  payload: unknown
): Promise<void> {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OTLP ${endpoint} failed: ${String(response.status)} ${body}`
    );
  }
}

/** Count rows in otel_logs using raw SQL (works with old schema without EventName). */
async function countLogs(client: ClickHouseClient): Promise<number> {
  const result = await client.query({
    query: `SELECT count() AS cnt FROM ${CH_DATABASE}.otel_logs`,
    format: "JSONEachRow",
  });
  const rows = await result.json<{ cnt: string }>();
  return Number(rows[0]?.cnt ?? 0);
}

/** Check if EventName column exists on otel_logs. */
async function hasEventNameColumn(client: ClickHouseClient): Promise<boolean> {
  const result = await client.query({
    query: `SELECT name FROM system.columns WHERE database = '${CH_DATABASE}' AND table = 'otel_logs' AND name = 'EventName'`,
    format: "JSONEachRow",
  });
  const rows = await result.json<{ name: string }>();
  return rows.length > 0;
}

describe("Migration: v0.136.0 → v0.148.0 (EventName column)", () => {
  let network: StartedNetwork;
  let clickhouseContainer: StartedTestContainer;
  let adminClient: ClickHouseClient;
  let ds: ClickHouseReadDatasource;
  let configPath: string;
  let chBaseUrl: string;

  beforeAll(async () => {
    // 1. Docker network
    network = await new Network().start();

    // 2. ClickHouse container (persists across all phases)
    clickhouseContainer = await new GenericContainer(CLICKHOUSE_IMAGE)
      .withNetwork(network)
      .withNetworkAliases("clickhouse")
      .withExposedPorts(CH_HTTP_PORT, CH_NATIVE_PORT)
      .withBindMounts([
        {
          source: path.join(dirname, "test-users.xml"),
          target: "/etc/clickhouse-server/users.d/test-users.xml",
        },
      ])
      .withWaitStrategy(
        Wait.forHttp("/", CH_HTTP_PORT).forResponsePredicate(
          (response) => response === "Ok.\n"
        )
      )
      .start();

    const chHost = clickhouseContainer.getHost();
    const chPort = clickhouseContainer.getMappedPort(CH_HTTP_PORT);
    chBaseUrl = `http://${chHost}:${String(chPort)}`;

    adminClient = createClient({
      url: chBaseUrl,
      username: CH_USERNAME,
      password: CH_PASSWORD,
    });

    await adminClient.command({
      query: `CREATE DATABASE IF NOT EXISTS ${CH_DATABASE}`,
    });

    // Write shared collector config
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "migration-otel-"));
    configPath = path.join(tmpDir, "config.yaml");
    await fs.writeFile(configPath, createOtelCollectorConfig(), "utf-8");

    ds = new ClickHouseReadDatasource(chBaseUrl);
  }, CONTAINER_STARTUP_TIMEOUT);

  afterAll(async () => {
    await ds?.close();
    await adminClient?.close();
    if (clickhouseContainer) await clickhouseContainer.stop();
    if (network) await network.stop();
  });

  // -----------------------------------------------------------------------
  // Phase 1: Old collector (v0.136.0) — ingest data WITHOUT EventName column
  //
  // The old collector creates otel_logs without EventName. We use raw SQL
  // to verify ingestion since our datasource now expects the column.
  // -----------------------------------------------------------------------

  describe("Phase 1: Old collector (v0.136.0)", () => {
    let collector: StartedTestContainer;

    beforeAll(async () => {
      collector = await startCollector(
        OTEL_COLLECTOR_VERSION_OLD,
        network,
        configPath
      );

      const otelHost = collector.getHost();
      const otelPort = collector.getMappedPort(OTEL_HTTP_PORT);
      const collectorUrl = `http://${otelHost}:${String(otelPort)}`;

      // Send logs without eventName
      await sendOtlp(collectorUrl, "/v1/logs", createLogsPayload());

      // Wait for ingestion using raw count
      await waitForData(async () => (await countLogs(adminClient)) > 0);
    }, CONTAINER_STARTUP_TIMEOUT);

    afterAll(async () => {
      if (collector) await collector.stop();
    });

    it("ingests logs with old collector", async () => {
      const count = await countLogs(adminClient);
      expect(count).toBe(2);
    });

    it("table does not have EventName column", async () => {
      expect(await hasEventNameColumn(adminClient)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Phase 2: Run migration — add EventName column
  //
  // After this, the datasource can query the table (EventName exists).
  // -----------------------------------------------------------------------

  describe("Phase 2: Migration", () => {
    beforeAll(async () => {
      await runMigrationFile("001_add_event_name_to_otel_logs.sql", chBaseUrl);
    });

    it("EventName column now exists", async () => {
      expect(await hasEventNameColumn(adminClient)).toBe(true);
    });

    it("migration SQL is idempotent", async () => {
      // Running the same file again should not error
      await runMigrationFile("001_add_event_name_to_otel_logs.sql", chBaseUrl);
    });

    it("old data is still readable after migration", async () => {
      const result = await ds.getLogs({
        serviceName: TEST_SERVICE_NAME,
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(2);
    });

    it("old rows have undefined EventName (default empty string)", async () => {
      const result = await ds.getLogs({
        serviceName: TEST_SERVICE_NAME,
        requestContext: requestContext(),
      });

      // ClickHouse fills existing rows with default empty string → chOptionalString → undefined
      for (const log of result.data) {
        expect(log.EventName).toBeUndefined();
      }
    });
  });

  // -----------------------------------------------------------------------
  // Phase 3: New collector (v0.148.0) — ingest data WITH EventName
  // -----------------------------------------------------------------------

  describe("Phase 3: New collector (v0.148.0)", () => {
    let collector: StartedTestContainer;

    beforeAll(async () => {
      collector = await startCollector(
        OTEL_COLLECTOR_VERSION,
        network,
        configPath
      );

      const otelHost = collector.getHost();
      const otelPort = collector.getMappedPort(OTEL_HTTP_PORT);
      const collectorUrl = `http://${otelHost}:${String(otelPort)}`;

      // Send logs WITH eventName
      await sendOtlp(
        collectorUrl,
        "/v1/logs",
        createLogsPayloadWithEventName()
      );

      // Wait for the new log to appear (2 old + at least 1 new)
      await waitForData(async () => (await countLogs(adminClient)) > 2);
    }, CONTAINER_STARTUP_TIMEOUT);

    afterAll(async () => {
      if (collector) await collector.stop();
    });

    it("reads both old and new logs", async () => {
      const result = await ds.getLogs({ requestContext: requestContext() });

      // 2 from old collector + 1 from new collector
      expect(result.data.length).toBe(3);
    });

    it("new logs have EventName populated", async () => {
      const result = await ds.getLogs({
        eventName: TEST_EVENT_NAME,
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      const log = result.data[0];
      expect(log).toBeDefined();
      expect(log?.EventName).toBe(TEST_EVENT_NAME);
      expect(log?.Body).toBe("User logged in successfully");
    });

    it("old logs still have undefined EventName", async () => {
      const result = await ds.getLogs({
        serviceName: TEST_SERVICE_NAME,
        requestContext: requestContext(),
      });

      // Old logs from Phase 1 (different service) still have empty/undefined EventName
      expect(result.data.length).toBe(2);
      for (const log of result.data) {
        expect(log.EventName).toBeUndefined();
      }
    });

    it("new logs are associated with the correct service", async () => {
      const result = await ds.getLogs({
        serviceName: TEST_EVENT_SERVICE_NAME,
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(1);
      const log = result.data[0];
      expect(log).toBeDefined();
      expect(log?.EventName).toBe(TEST_EVENT_NAME);
    });

    it("eventName filter returns no results for non-existent event", async () => {
      const result = await ds.getLogs({
        eventName: "does.not.exist",
        requestContext: requestContext(),
      });

      expect(result.data.length).toBe(0);
    });
  });
});
