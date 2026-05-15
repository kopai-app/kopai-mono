/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricDonutChart, __testing__ } from "./index.js";
import type { denormalizedSignals } from "@kopai/core";

type AggregatedMetricRow = denormalizedSignals.AggregatedMetricRow;

const tokenRows: AggregatedMetricRow[] = [
  { groups: { type: "cacheRead" }, value: 1_546_066_884 },
  { groups: { type: "cacheCreation" }, value: 29_333_420 },
  { groups: { type: "output" }, value: 4_888_000 },
  { groups: { type: "input" }, value: 1_063_000 },
];

describe("MetricDonutChart", () => {
  it("produces one slice per row", () => {
    const slices = __testing__.buildSlices(tokenRows, 6);
    expect(slices).toHaveLength(tokenRows.length);
    const labels = slices.map((s) => s.label).sort();
    expect(labels).toEqual(
      ["cacheCreation", "cacheRead", "input", "output"].sort()
    );
  });

  it("aggregates overflow into 'Other' when rows.length > maxSlices", () => {
    const slices = __testing__.buildSlices(tokenRows, 3);
    // Top 2 by value DESC + Other
    expect(slices).toHaveLength(3);
    expect(slices[0]!.label).toBe("cacheRead");
    expect(slices[1]!.label).toBe("cacheCreation");
    expect(slices[2]!.label).toBe("Other");
    // Other = output + input
    expect(slices[2]!.value).toBe(4_888_000 + 1_063_000);
  });

  it("'Other' percentage equals sum of dropped slices / total", () => {
    const slices = __testing__.buildSlices(tokenRows, 3);
    const total = tokenRows.reduce((acc, r) => acc + r.value, 0);
    const otherSlice = slices.find((s) => s.label === "Other")!;
    const expectedPct = ((4_888_000 + 1_063_000) / total) * 100;
    expect(otherSlice.percent).toBeCloseTo(expectedPct, 5);
  });

  it("tooltip formatter renders label + value + percentage", () => {
    const slices = __testing__.buildSlices(tokenRows, 6);
    const total = tokenRows.reduce((acc, r) => acc + r.value, 0);
    const node = __testing__.renderTooltipContent({
      active: true,
      payload: [
        {
          name: slices[0]!.label,
          value: slices[0]!.value,
          payload: slices[0]!,
        },
      ],
      total,
      formatValue: (v: number) => v.toString(),
      unit: undefined,
    });
    const { container } = render(node);
    expect(container.textContent).toContain("cacheRead");
    expect(container.textContent).toContain("1546066884");
    // percentage of total
    const pct = ((slices[0]!.value / total) * 100).toFixed(1);
    expect(container.textContent).toContain(`${pct}%`);
  });

  it("does not render legend when showLegend=false", () => {
    const { container } = render(
      <MetricDonutChart rows={tokenRows} showLegend={false} />
    );
    // Recharts legend wrapper uses class .recharts-legend-wrapper
    expect(container.querySelector(".recharts-legend-wrapper")).toBeNull();
  });

  it("renders '(no value)' for missing/empty group values", () => {
    const rows: AggregatedMetricRow[] = [
      { groups: { type: "" }, value: 100 },
      { groups: {}, value: 50 },
      { groups: { type: "cacheRead" }, value: 200 },
    ];
    const slices = __testing__.buildSlices(rows, 6);
    const noValueSlices = slices.filter((s) => s.label === "(no value)");
    expect(noValueSlices).toHaveLength(2);
  });

  it("renders loading skeleton when isLoading", () => {
    render(<MetricDonutChart rows={[]} isLoading />);
    expect(screen.getByTestId("metric-donut-chart-loading")).toBeTruthy();
  });

  it("renders error UI when error is provided", () => {
    render(<MetricDonutChart rows={[]} error={new globalThis.Error("boom")} />);
    expect(screen.getByTestId("metric-donut-chart-error")).toBeTruthy();
    expect(screen.getByText(/boom/)).toBeTruthy();
  });

  it("renders empty state when rows is empty", () => {
    render(<MetricDonutChart rows={[]} />);
    expect(screen.getByTestId("metric-donut-chart-empty")).toBeTruthy();
  });
});
