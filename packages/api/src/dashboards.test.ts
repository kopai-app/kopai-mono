import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { dashboardDatasource } from "@kopai/core";
import { dashboardsRoutes } from "./index.js";
import { SignalsApiError } from "./routes/errors.js";

class TestApiError extends SignalsApiError {
  readonly code = "TEST_ERROR";
}

const mockDashboard: dashboardDatasource.Dashboard = {
  id: "dash-001",
  name: "Test Dashboard",
  createdAt: "2025-01-01T00:00:00Z",
  metadata: {},
  uiTreeVersion: "1.0.0" as dashboardDatasource.Dashboard["uiTreeVersion"],
  uiTree: { root: "root", elements: {} },
};

describe("dashboardsRoutes", () => {
  let server: FastifyInstance;
  let createDashboardSpy: ReturnType<
    typeof vi.fn<
      dashboardDatasource.DynamicDashboardDatasource["createDashboard"]
    >
  >;
  let getDashboardSpy: ReturnType<
    typeof vi.fn<dashboardDatasource.DynamicDashboardDatasource["getDashboard"]>
  >;
  let searchDashboardsSpy: ReturnType<
    typeof vi.fn<
      dashboardDatasource.DynamicDashboardDatasource["searchDashboards"]
    >
  >;

  beforeEach(async () => {
    createDashboardSpy =
      vi.fn<
        dashboardDatasource.DynamicDashboardDatasource["createDashboard"]
      >();
    getDashboardSpy =
      vi.fn<dashboardDatasource.DynamicDashboardDatasource["getDashboard"]>();
    searchDashboardsSpy =
      vi.fn<
        dashboardDatasource.DynamicDashboardDatasource["searchDashboards"]
      >();
    // Bare Fastify works because dashboardsRoutes sets its own
    // validator, serializer, and errorHandler internally.
    server = Fastify();
    await server.register(dashboardsRoutes, {
      dynamicDashboardDatasource: {
        createDashboard: createDashboardSpy,
        getDashboard: getDashboardSpy,
        searchDashboards: searchDashboardsSpy,
      },
    });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  describe("POST /dashboards", () => {
    it("returns 201 and calls createDashboard", async () => {
      createDashboardSpy.mockResolvedValue(mockDashboard);

      const body = {
        name: "Test Dashboard",
        uiTreeVersion: "1.0.0",
        uiTree: { root: "root", elements: {} },
      };
      const response = await server.inject({
        method: "POST",
        url: "/dashboards",
        payload: body,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual(mockDashboard);
      expect(createDashboardSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: body.name,
          uiTreeVersion: body.uiTreeVersion,
          requestContext: undefined,
        })
      );
    });

    it("returns 400 for invalid uiTreeVersion", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/dashboards",
        payload: {
          name: "Test",
          uiTreeVersion: "not-semver",
          uiTree: {},
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-validation-error",
        status: 400,
        title: "Invalid data",
      });
    });

    it("returns 400 for missing name", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/dashboards",
        payload: {
          uiTreeVersion: "1.0.0",
          uiTree: {},
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 500 for SignalsApiError", async () => {
      createDashboardSpy.mockRejectedValue(
        new TestApiError("Database failure")
      );

      const response = await server.inject({
        method: "POST",
        url: "/dashboards",
        payload: {
          name: "Test",
          uiTreeVersion: "1.0.0",
          uiTree: {},
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-internal-error",
        status: 500,
        title: "Internal server error",
        detail: "Database failure",
      });
    });

    it("returns 500 for unexpected error", async () => {
      createDashboardSpy.mockRejectedValue(new Error("Unexpected"));

      const response = await server.inject({
        method: "POST",
        url: "/dashboards",
        payload: {
          name: "Test",
          uiTreeVersion: "1.0.0",
          uiTree: {},
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-internal-error",
        status: 500,
        title: "Internal server error",
      });
    });
  });

  describe("GET /dashboards/:dashboardId", () => {
    it("returns 200 and calls getDashboard with id", async () => {
      getDashboardSpy.mockResolvedValue(mockDashboard);

      const response = await server.inject({
        method: "GET",
        url: "/dashboards/dash-001",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockDashboard);
      expect(getDashboardSpy).toHaveBeenCalledWith({
        id: "dash-001",
        requestContext: undefined,
      });
    });

    it("returns 404 when dashboard not found", async () => {
      getDashboardSpy.mockRejectedValue(
        new TestApiError("Dashboard not found: missing")
      );

      const response = await server.inject({
        method: "GET",
        url: "/dashboards/missing",
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/dashboard-not-found",
        status: 404,
        title: "Dashboard not found",
      });
    });
  });

  describe("POST /dashboards/search", () => {
    it("returns 200 and calls searchDashboards with filter", async () => {
      searchDashboardsSpy.mockResolvedValue({
        data: [mockDashboard],
        nextCursor: null,
      });

      const filter = { name: "Test" };
      const response = await server.inject({
        method: "POST",
        url: "/dashboards/search",
        payload: filter,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        data: [mockDashboard],
        nextCursor: null,
      });
      expect(searchDashboardsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Test",
          requestContext: undefined,
        })
      );
    });

    it("returns 400 for invalid limit", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/dashboards/search",
        payload: { limit: 9999 },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-validation-error",
        status: 400,
        title: "Invalid data",
      });
    });

    it("returns 500 for SignalsApiError", async () => {
      searchDashboardsSpy.mockRejectedValue(
        new TestApiError("Database failure")
      );

      const response = await server.inject({
        method: "POST",
        url: "/dashboards/search",
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        type: "https://docs.kopai.app/errors/signals-api-internal-error",
        status: 500,
        detail: "Database failure",
      });
    });
  });
});
