import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

const searchLogsPageMock = vi.fn();
const searchLogsAggregateMock = vi.fn();

vi.mock("../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client.js")>();
  return {
    ...actual,
    createClient: vi.fn(() => ({
      searchLogsPage: searchLogsPageMock,
      searchLogsAggregate: searchLogsAggregateMock,
    })),
  };
});

import { createLogsCommand } from "./logs.js";

interface RunResult {
  output: string;
  error?: unknown;
}

function runCommand(args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) =>
      logs.push(a.join(" "))
    );
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) =>
      logs.push(a.join(" "))
    );
    vi.spyOn(console, "table").mockImplementation((data: unknown) =>
      logs.push(`TABLE: ${JSON.stringify(data)}`)
    );

    const program = new Command();
    program.exitOverride();
    program.addCommand(createLogsCommand());

    program.parseAsync(["node", "test", "logs", ...args]).then(
      () => resolve({ output: logs.join("\n") }),
      (err) => resolve({ output: logs.join("\n"), error: err })
    );
  });
}

describe("logs search aggregate", () => {
  beforeEach(() => {
    searchLogsPageMock.mockReset();
    searchLogsAggregateMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls searchLogsAggregate with aggregate+groupBy", async () => {
    searchLogsAggregateMock.mockResolvedValue({
      data: [{ groups: { tool_name: "Bash", decision: "accept" }, value: 7 }],
      nextCursor: null,
    });

    await runCommand([
      "search",
      "--service",
      "claude-code",
      "--aggregate",
      "count",
      "--group-by",
      "tool_name",
      "--group-by",
      "decision",
      "--json",
    ]);

    expect(searchLogsAggregateMock).toHaveBeenCalledTimes(1);
    expect(searchLogsPageMock).not.toHaveBeenCalled();
    const callArg = searchLogsAggregateMock.mock.calls[0]![0];
    expect(callArg).toMatchObject({
      serviceName: "claude-code",
      aggregate: "count",
      groupBy: ["tool_name", "decision"],
    });
  });

  it("calls searchLogsPage when --aggregate is absent", async () => {
    searchLogsPageMock.mockResolvedValue({ data: [], nextCursor: null });

    await runCommand(["search", "--service", "claude-code", "--json"]);

    expect(searchLogsPageMock).toHaveBeenCalledTimes(1);
    expect(searchLogsAggregateMock).not.toHaveBeenCalled();
  });

  it("rejects --aggregate without --group-by", async () => {
    const result = await runCommand([
      "search",
      "--aggregate",
      "count",
      "--json",
    ]);

    expect(searchLogsAggregateMock).not.toHaveBeenCalled();
    expect(result.error).toBeDefined();
    expect(result.output).toContain(
      "--aggregate requires at least one --group-by"
    );
  });

  it("rejects --group-by without --aggregate", async () => {
    const result = await runCommand([
      "search",
      "--service",
      "claude-code",
      "--group-by",
      "tool_name",
      "--json",
    ]);

    expect(searchLogsPageMock).not.toHaveBeenCalled();
    expect(searchLogsAggregateMock).not.toHaveBeenCalled();
    expect(result.error).toBeDefined();
    expect(result.output).toContain("--group-by requires --aggregate");
  });
});
