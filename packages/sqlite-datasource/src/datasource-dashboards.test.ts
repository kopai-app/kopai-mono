/// <reference types="vitest/globals" />
import { DatabaseSync } from "node:sqlite";
import { DashboardDbDatasource } from "./dashboard-datasource.js";
import { initializeDatabase } from "./initialize-database.js";
import { SqliteDatasourceQueryError } from "./sqlite-datasource-error.js";
import { dashboardDatasource } from "@kopai/core";

type Dashboard = dashboardDatasource.Dashboard;

/** Parse a semver string through the branded schema for type-safe test values */
const semver = (s: string) => dashboardDatasource.semverSchema.parse(s);

describe("DashboardDbDatasource", () => {
  let testConnection: DatabaseSync;
  let ds: DashboardDbDatasource;

  beforeEach(() => {
    testConnection = initializeDatabase(":memory:");
    ds = new DashboardDbDatasource(testConnection);
  });

  afterEach(() => {
    testConnection.close();
  });

  async function createTestDashboard(
    overrides: Partial<{
      name: string;
      uiTreeVersion: string;
      uiTree: Record<string, unknown>;
      metadata: Record<string, unknown>;
    }> = {}
  ): Promise<Dashboard> {
    return ds.createDashboard({
      name: overrides.name ?? "Test Dashboard",
      uiTreeVersion: (overrides.uiTreeVersion ??
        "1.0.0") as Dashboard["uiTreeVersion"],
      uiTree: overrides.uiTree ?? { root: "root" },
      metadata: overrides.metadata ?? {},
    });
  }

  describe("createDashboard", () => {
    it("creates dashboard with generated id and createdAt", async () => {
      const result = await createTestDashboard({ name: "My Dashboard" });

      expect(result.id).toBeDefined();
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(result.createdAt).toBeDefined();
      expect(result.name).toBe("My Dashboard");
      expect(result.uiTreeVersion).toBe("1.0.0");
      expect(result.uiTree).toEqual({ root: "root" });
      expect(result.metadata).toEqual({});
    });

    it("stores uiTreeVersionMajor correctly", async () => {
      const d1 = await createTestDashboard({ uiTreeVersion: "2.3.4" });
      const d2 = await createTestDashboard({ uiTreeVersion: "0.1.0" });

      // Verify via search with compatible filter
      const result = await ds.searchDashboards({
        uiTreeVersionCompatible: semver("2.0.0"),
        limit: 100,
        sortOrder: "DESC",
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.id).toBe(d1.id);

      const result0 = await ds.searchDashboards({
        uiTreeVersionCompatible: semver("0.5.0"),
        limit: 100,
        sortOrder: "DESC",
      });
      expect(result0.data).toHaveLength(1);
      expect(result0.data[0]!.id).toBe(d2.id);
    });
  });

  describe("getDashboard", () => {
    it("retrieves dashboard by id", async () => {
      const created = await createTestDashboard({
        name: "Get Test",
        metadata: { env: "test" },
      });

      const result = await ds.getDashboard({ id: created.id });

      expect(result.id).toBe(created.id);
      expect(result.name).toBe("Get Test");
      expect(result.metadata).toEqual({ env: "test" });
      expect(result.uiTree).toEqual({ root: "root" });
    });

    it("throws for missing id", async () => {
      await expect(ds.getDashboard({ id: "nonexistent" })).rejects.toThrow(
        SqliteDatasourceQueryError
      );
    });
  });

  describe("searchDashboards", () => {
    it("returns all dashboards, DESC by createdAt", async () => {
      const d1 = await createTestDashboard({ name: "First" });
      const d2 = await createTestDashboard({ name: "Second" });

      const result = await ds.searchDashboards({
        limit: 100,
        sortOrder: "DESC",
      });

      expect(result.data).toHaveLength(2);
      const ids = result.data.map((d) => d.id);
      expect(ids).toContain(d1.id);
      expect(ids).toContain(d2.id);
      expect(result.nextCursor).toBeNull();
    });

    it("filters by name substring", async () => {
      await createTestDashboard({ name: "Production Dashboard" });
      await createTestDashboard({ name: "Staging Dashboard" });
      await createTestDashboard({ name: "Other Thing" });

      const result = await ds.searchDashboards({
        name: "Dashboard",
        limit: 100,
        sortOrder: "DESC",
      });

      expect(result.data).toHaveLength(2);
    });

    it("filters by createdAt range", async () => {
      // Insert directly to control timestamps
      const d1 = await createTestDashboard({ name: "Old" });
      const d2 = await createTestDashboard({ name: "New" });

      // Search for everything (createdAt range covers both)
      const result = await ds.searchDashboards({
        createdAtMin: d1.createdAt,
        createdAtMax: d2.createdAt,
        limit: 100,
        sortOrder: "DESC",
      });

      expect(result.data.length).toBeGreaterThanOrEqual(1);
    });

    it("filters by exact uiTreeVersion", async () => {
      await createTestDashboard({
        name: "v1",
        uiTreeVersion: "1.0.0",
      });
      await createTestDashboard({
        name: "v2",
        uiTreeVersion: "2.0.0",
      });

      const result = await ds.searchDashboards({
        uiTreeVersion: semver("1.0.0"),
        limit: 100,
        sortOrder: "DESC",
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.name).toBe("v1");
    });

    it("filters by uiTreeVersionCompatible (major match)", async () => {
      await createTestDashboard({
        name: "v1.0",
        uiTreeVersion: "1.0.0",
      });
      await createTestDashboard({
        name: "v1.2",
        uiTreeVersion: "1.2.3",
      });
      await createTestDashboard({
        name: "v2.0",
        uiTreeVersion: "2.0.0",
      });

      const result = await ds.searchDashboards({
        uiTreeVersionCompatible: semver("1.5.0"),
        limit: 100,
        sortOrder: "DESC",
      });

      expect(result.data).toHaveLength(2);
      expect(result.data.every((d) => d.uiTreeVersion.startsWith("1."))).toBe(
        true
      );
    });

    it("filters by metadata key/value", async () => {
      await createTestDashboard({
        name: "With Tag",
        metadata: { env: "prod", team: "infra" },
      });
      await createTestDashboard({
        name: "Other",
        metadata: { env: "staging" },
      });

      const result = await ds.searchDashboards({
        metadata: { env: "prod" },
        limit: 100,
        sortOrder: "DESC",
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.name).toBe("With Tag");
    });

    it("paginates with cursor and limit", async () => {
      // Create 5 dashboards
      for (let i = 0; i < 5; i++) {
        await createTestDashboard({ name: `Dashboard ${i}` });
      }

      const page1 = await ds.searchDashboards({
        limit: 2,
        sortOrder: "DESC",
      });

      expect(page1.data).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await ds.searchDashboards({
        limit: 2,
        sortOrder: "DESC",
        cursor: page1.nextCursor!,
      });

      expect(page2.data).toHaveLength(2);
      expect(page2.nextCursor).not.toBeNull();

      const page3 = await ds.searchDashboards({
        limit: 2,
        sortOrder: "DESC",
        cursor: page2.nextCursor!,
      });

      expect(page3.data).toHaveLength(1);
      expect(page3.nextCursor).toBeNull();

      // All IDs should be unique
      const allIds = [...page1.data, ...page2.data, ...page3.data].map(
        (d) => d.id
      );
      expect(new Set(allIds).size).toBe(5);
    });

    it("sorts ASC", async () => {
      await createTestDashboard({ name: "First" });
      await createTestDashboard({ name: "Second" });

      const descResult = await ds.searchDashboards({
        limit: 100,
        sortOrder: "DESC",
      });
      const ascResult = await ds.searchDashboards({
        limit: 100,
        sortOrder: "ASC",
      });

      // ASC and DESC should return same items in reverse order
      expect(ascResult.data).toHaveLength(2);
      expect(descResult.data).toHaveLength(2);
      expect(ascResult.data[0]!.id).toBe(descResult.data[1]!.id);
      expect(ascResult.data[1]!.id).toBe(descResult.data[0]!.id);
    });

    it("throws for invalid metadata key", async () => {
      await expect(
        ds.searchDashboards({
          metadata: { 'key"; DROP TABLE dashboards;--': "val" },
          limit: 100,
          sortOrder: "DESC",
        })
      ).rejects.toThrow(SqliteDatasourceQueryError);
    });

    it("throws for invalid cursor format", async () => {
      await expect(
        ds.searchDashboards({
          cursor: "no-separator",
          limit: 100,
          sortOrder: "DESC",
        })
      ).rejects.toThrow(SqliteDatasourceQueryError);
    });

    it("combines multiple filters", async () => {
      await createTestDashboard({
        name: "Prod Dashboard",
        uiTreeVersion: "1.0.0",
        metadata: { env: "prod" },
      });
      await createTestDashboard({
        name: "Staging Dashboard",
        uiTreeVersion: "1.0.0",
        metadata: { env: "staging" },
      });
      await createTestDashboard({
        name: "Prod Dashboard v2",
        uiTreeVersion: "2.0.0",
        metadata: { env: "prod" },
      });

      const result = await ds.searchDashboards({
        name: "Prod",
        uiTreeVersionCompatible: semver("1.0.0"),
        metadata: { env: "prod" },
        limit: 100,
        sortOrder: "DESC",
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.name).toBe("Prod Dashboard");
    });
  });
});
