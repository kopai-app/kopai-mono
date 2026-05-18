import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { Readable } from "node:stream";

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({}),
  };
});

const mockCreateDashboard = vi.fn();

vi.mock("@kopai/sdk", () => ({
  KopaiClient: class MockKopaiClient {
    createDashboard = mockCreateDashboard;
  },
}));

import { loadConfig } from "../config.js";
import { createDashboardsCommand } from "./dashboards.js";

const VALID_TREE = {
  uiTree: {
    root: "s1",
    elements: {
      s1: {
        key: "s1",
        type: "Stack",
        props: { direction: "vertical", gap: "md", align: null },
        children: [],
        parentKey: "",
      },
    },
  },
  metadata: {},
};

function pushStdin(payload: string): void {
  const stream = Readable.from([Buffer.from(payload, "utf-8")]);
  Object.defineProperty(process, "stdin", {
    configurable: true,
    value: stream,
  });
}

function runCreate(args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) =>
      logs.push(a.join(" "))
    );
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) =>
      logs.push(a.join(" "))
    );

    pushStdin(stdin);

    const program = new Command();
    program.exitOverride();
    program.addCommand(createDashboardsCommand());

    program
      .parseAsync([
        "node",
        "test",
        "dashboards",
        "create",
        "--name",
        "Test",
        "--tree-version",
        "0.7.0",
        "--json",
        ...args,
      ])
      .then(
        () => resolve(logs.join("\n")),
        (err) => reject(err)
      );
  });
}

describe("dashboards create command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockReturnValue({});
    mockCreateDashboard.mockResolvedValue({
      id: "dash-123",
      name: "Test",
      createdAt: "2026-05-18T00:00:00.000Z",
      metadata: {},
      uiTreeVersion: "0.7.0",
      uiTree: VALID_TREE.uiTree,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes a url built from the .kopairc url in the JSON response", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      url: "https://custom.example.com",
    });

    const output = await runCreate([], JSON.stringify(VALID_TREE));
    const parsed = JSON.parse(output) as { url: string; id: string };

    expect(parsed.id).toBe("dash-123");
    expect(parsed.url).toBe(
      "https://custom.example.com/?tab=metrics&dashboardId=dash-123"
    );
  });

  it("uses --url flag value over .kopairc when both present", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      url: "https://from-config.example.com",
    });

    const output = await runCreate(
      ["--url", "https://from-flag.example.com"],
      JSON.stringify(VALID_TREE)
    );
    const parsed = JSON.parse(output) as { url: string };

    expect(parsed.url).toBe(
      "https://from-flag.example.com/?tab=metrics&dashboardId=dash-123"
    );
  });

  it("falls back to localhost default when no url is configured", async () => {
    vi.mocked(loadConfig).mockReturnValue({});

    const output = await runCreate([], JSON.stringify(VALID_TREE));
    const parsed = JSON.parse(output) as { url: string };

    expect(parsed.url).toBe(
      "http://localhost:8000/?tab=metrics&dashboardId=dash-123"
    );
  });

  it("strips trailing /signals path from configured url before building dashboard url", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      url: "https://hosted.example.com/signals",
    });

    const output = await runCreate([], JSON.stringify(VALID_TREE));
    const parsed = JSON.parse(output) as { url: string };

    expect(parsed.url).toBe(
      "https://hosted.example.com/?tab=metrics&dashboardId=dash-123"
    );
  });

  it("encodes the dashboard id in the url", async () => {
    mockCreateDashboard.mockResolvedValue({
      id: "needs/encoding",
      name: "Test",
      createdAt: "2026-05-18T00:00:00.000Z",
      metadata: {},
      uiTreeVersion: "0.7.0",
      uiTree: VALID_TREE.uiTree,
    });

    const output = await runCreate([], JSON.stringify(VALID_TREE));
    const parsed = JSON.parse(output) as { url: string };

    expect(parsed.url).toBe(
      "http://localhost:8000/?tab=metrics&dashboardId=needs%2Fencoding"
    );
  });
});
