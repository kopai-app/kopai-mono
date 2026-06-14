import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

const searchMetricsPageMock = vi.fn();
const searchAggregatedMetricsMock = vi.fn();
const searchMetricsTimeSeriesMock = vi.fn();

vi.mock("../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client.js")>();
  return {
    ...actual,
    createClient: vi.fn(() => ({
      searchMetricsPage: searchMetricsPageMock,
      searchAggregatedMetrics: searchAggregatedMetricsMock,
      searchMetricsTimeSeries: searchMetricsTimeSeriesMock,
    })),
  };
});

import { createMetricsCommand } from "./metrics.js";

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
    program.addCommand(createMetricsCommand());

    program.parseAsync(["node", "test", "metrics", ...args]).then(
      () => resolve({ output: logs.join("\n") }),
      (err) => resolve({ output: logs.join("\n"), error: err })
    );
  });
}

describe("metrics search timeseries", () => {
  beforeEach(() => {
    searchMetricsPageMock.mockReset();
    searchAggregatedMetricsMock.mockReset();
    searchMetricsTimeSeriesMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls searchMetricsTimeSeries with aggregate+groupBy+timeBucket", async () => {
    searchMetricsTimeSeriesMock.mockResolvedValue({
      data: [
        {
          groups: { model: "opus" },
          timeBucketNs: "1705000000000000000",
          value: 12.5,
        },
      ],
      nextCursor: null,
    });

    await runCommand([
      "search",
      "--type",
      "Sum",
      "--name",
      "claude_code.cost.usage",
      "--aggregate",
      "sum",
      "--group-by",
      "model",
      "--time-bucket",
      "1d",
      "--json",
    ]);

    expect(searchMetricsTimeSeriesMock).toHaveBeenCalledTimes(1);
    expect(searchAggregatedMetricsMock).not.toHaveBeenCalled();
    expect(searchMetricsPageMock).not.toHaveBeenCalled();
    const callArg = searchMetricsTimeSeriesMock.mock.calls[0]![0];
    expect(callArg).toMatchObject({
      metricType: "Sum",
      metricName: "claude_code.cost.usage",
      aggregate: "sum",
      groupBy: ["model"],
      timeBucket: "1d",
    });
  });

  it("calls searchAggregatedMetrics when --aggregate is set but --time-bucket is not", async () => {
    searchAggregatedMetricsMock.mockResolvedValue({
      data: [{ groups: { model: "opus" }, value: 100 }],
      nextCursor: null,
    });

    await runCommand([
      "search",
      "--type",
      "Sum",
      "--aggregate",
      "sum",
      "--group-by",
      "model",
      "--json",
    ]);

    expect(searchAggregatedMetricsMock).toHaveBeenCalledTimes(1);
    expect(searchMetricsTimeSeriesMock).not.toHaveBeenCalled();
  });

  it("calls searchMetricsPage when neither --aggregate nor --time-bucket is set", async () => {
    searchMetricsPageMock.mockResolvedValue({ data: [], nextCursor: null });

    await runCommand(["search", "--type", "Gauge", "--json"]);

    expect(searchMetricsPageMock).toHaveBeenCalledTimes(1);
    expect(searchAggregatedMetricsMock).not.toHaveBeenCalled();
    expect(searchMetricsTimeSeriesMock).not.toHaveBeenCalled();
  });

  it("rejects --time-bucket without --aggregate", async () => {
    const result = await runCommand([
      "search",
      "--type",
      "Sum",
      "--group-by",
      "model",
      "--time-bucket",
      "1d",
      "--json",
    ]);

    expect(searchMetricsTimeSeriesMock).not.toHaveBeenCalled();
    expect(result.error).toBeDefined();
    expect(result.output).toContain("--time-bucket requires --aggregate");
  });

  it("rejects --time-bucket without --group-by", async () => {
    const result = await runCommand([
      "search",
      "--type",
      "Sum",
      "--aggregate",
      "sum",
      "--time-bucket",
      "1d",
      "--json",
    ]);

    expect(searchMetricsTimeSeriesMock).not.toHaveBeenCalled();
    expect(result.error).toBeDefined();
    expect(result.output).toContain(
      "--time-bucket requires at least one --group-by"
    );
  });

  it("rejects invalid --time-bucket value", async () => {
    const result = await runCommand([
      "search",
      "--type",
      "Sum",
      "--aggregate",
      "sum",
      "--group-by",
      "model",
      "--time-bucket",
      "10s",
      "--json",
    ]);

    expect(searchMetricsTimeSeriesMock).not.toHaveBeenCalled();
    expect(result.error).toBeDefined();
    expect(result.output).toContain("Invalid time bucket");
  });

  it("rejects --group-by without --aggregate", async () => {
    const result = await runCommand([
      "search",
      "--type",
      "Sum",
      "--group-by",
      "model",
      "--json",
    ]);

    expect(searchMetricsPageMock).not.toHaveBeenCalled();
    expect(searchAggregatedMetricsMock).not.toHaveBeenCalled();
    expect(searchMetricsTimeSeriesMock).not.toHaveBeenCalled();
    expect(result.error).toBeDefined();
    expect(result.output).toContain("--group-by requires --aggregate");
  });
});
