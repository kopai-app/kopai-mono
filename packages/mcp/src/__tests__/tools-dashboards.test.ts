import { describe, it, expect, vi } from "vitest";
import type { dashboardDatasource } from "@kopai/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDashboardTools } from "../tools/dashboards.js";
import { connectTestClient, parseJsonContent } from "./helpers.js";

type Ds = dashboardDatasource.DynamicDashboardDatasource;

function makeDs(): {
  ds: Ds;
  getDashboard: ReturnType<typeof vi.fn<Ds["getDashboard"]>>;
  createDashboard: ReturnType<typeof vi.fn<Ds["createDashboard"]>>;
  searchDashboards: ReturnType<typeof vi.fn<Ds["searchDashboards"]>>;
} {
  const getDashboard = vi.fn<Ds["getDashboard"]>();
  const createDashboard = vi.fn<Ds["createDashboard"]>();
  const searchDashboards = vi.fn<Ds["searchDashboards"]>();
  return {
    ds: { getDashboard, createDashboard, searchDashboards },
    getDashboard,
    createDashboard,
    searchDashboards,
  };
}

function buildServer(ds: Ds, promptInstructions?: string) {
  const s = new McpServer({ name: "test", version: "0" });
  registerDashboardTools(s, ds, promptInstructions);
  return s;
}

const stubDashboard = {
  id: "d1",
  name: "test",
  createdAt: "2026-01-01T00:00:00.000Z",
  metadata: {},
  uiTreeVersion: "1.0.0" as unknown as never,
  uiTree: {},
};

describe("dashboards mcp tools", () => {
  it("get_dashboard_schema returns prompt instructions", async () => {
    const { ds } = makeDs();
    const client = await connectTestClient(buildServer(ds, "# instructions"));
    const res = await client.callTool({
      name: "kopai_get_dashboard_schema",
      arguments: {},
    });
    expect(res.isError).toBeFalsy();
    const content = (res as { content: Array<{ type: string; text: string }> })
      .content[0];
    expect(content?.type).toBe("text");
    expect(content?.text).toBe("# instructions");
  });

  it("get_dashboard_schema errors when promptInstructions not configured", async () => {
    const { ds } = makeDs();
    const client = await connectTestClient(buildServer(ds));
    const res = await client.callTool({
      name: "kopai_get_dashboard_schema",
      arguments: {},
    });
    expect(res.isError).toBe(true);
  });

  it("create_dashboard forwards the body", async () => {
    const { ds, createDashboard } = makeDs();
    createDashboard.mockResolvedValue(stubDashboard);

    const client = await connectTestClient(buildServer(ds));
    const body = {
      name: "new",
      uiTreeVersion: "1.0.0",
      uiTree: {},
    };
    const res = await client.callTool({
      name: "kopai_create_dashboard",
      arguments: body,
    });

    expect(createDashboard).toHaveBeenCalledWith({
      name: "new",
      uiTreeVersion: "1.0.0",
      uiTree: {},
      metadata: {},
    });
    expect(parseJsonContent(res)).toEqual(stubDashboard);
  });

  it("get_dashboard maps dashboardId to { id }", async () => {
    const { ds, getDashboard } = makeDs();
    getDashboard.mockResolvedValue(stubDashboard);

    const client = await connectTestClient(buildServer(ds));
    const res = await client.callTool({
      name: "kopai_get_dashboard",
      arguments: { dashboardId: "d1" },
    });

    expect(getDashboard).toHaveBeenCalledWith({ id: "d1" });
    expect(parseJsonContent(res)).toEqual(stubDashboard);
  });

  it("search_dashboards forwards the filter body", async () => {
    const { ds, searchDashboards } = makeDs();
    searchDashboards.mockResolvedValue({ data: [], nextCursor: null });

    const client = await connectTestClient(buildServer(ds));
    const res = await client.callTool({
      name: "kopai_search_dashboards",
      arguments: { name: "foo" },
    });

    expect(searchDashboards).toHaveBeenCalledWith({
      name: "foo",
      limit: 100,
      sortOrder: "DESC",
    });
    expect(parseJsonContent(res)).toEqual({ data: [], nextCursor: null });
  });
});
