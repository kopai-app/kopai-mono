/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetricBarChart } from "./index.js";
import type { denormalizedSignals } from "@kopai/core";

type AggregatedMetricRow = denormalizedSignals.AggregatedMetricRow;

// ---------------------------------------------------------------------------
// Recharts in jsdom needs a non-zero ResponsiveContainer parent. Patch it via
// a wrapper so getBoundingClientRect returns non-zero dimensions.
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Force ResponsiveContainer to render by stubbing getBoundingClientRect
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width: 800,
      height: 400,
      top: 0,
      left: 0,
      right: 800,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  // Recharts uses ResizeObserver
  globalThis.ResizeObserver =
    globalThis.ResizeObserver ??
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const rows: AggregatedMetricRow[] = [
  { groups: { model: "opus-4-7" }, value: 822.0 },
  { groups: { model: "sonnet-4-6" }, value: 131.0 },
  { groups: { model: "haiku-4-5" }, value: 7.0 },
];

describe("MetricBarChart", () => {
  it("renders one bar per row with correct labels", () => {
    render(<MetricBarChart rows={rows} />);
    const chart = screen.getByTestId("metric-bar-chart");
    expect(chart).toBeTruthy();
    const labels = JSON.parse(
      chart.getAttribute("data-bar-labels") ?? "[]"
    ) as string[];
    expect(labels).toEqual(["opus-4-7", "sonnet-4-6", "haiku-4-5"]);
  });

  it("slices to top maxBars by value DESC", () => {
    const many: AggregatedMetricRow[] = [
      { groups: { m: "a" }, value: 10 },
      { groups: { m: "b" }, value: 50 },
      { groups: { m: "c" }, value: 5 },
      { groups: { m: "d" }, value: 100 },
      { groups: { m: "e" }, value: 1 },
    ];
    render(<MetricBarChart rows={many} maxBars={3} />);
    const chart = screen.getByTestId("metric-bar-chart");
    const labels = JSON.parse(
      chart.getAttribute("data-bar-labels") ?? "[]"
    ) as string[];
    // Top 3 by value DESC: d(100), b(50), a(10)
    expect(labels).toEqual(["d", "b", "a"]);
  });

  it("renders horizontal orientation with vertical layout", () => {
    render(<MetricBarChart rows={rows} orientation="horizontal" />);
    const chart = screen.getByTestId("metric-bar-chart");
    expect(chart).toBeTruthy();
    expect(chart.getAttribute("data-bar-orientation")).toBe("horizontal");
    // Recharts BarChart receives layout="vertical" for horizontal orientation
    expect(chart.getAttribute("data-bar-layout")).toBe("vertical");
  });

  it("does not crash with value=0 row when logScale=true", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const withZero: AggregatedMetricRow[] = [
      { groups: { m: "a" }, value: 100 },
      { groups: { m: "b" }, value: 0 },
      { groups: { m: "c" }, value: 50 },
    ];
    render(<MetricBarChart rows={withZero} logScale />);
    const chart = screen.getByTestId("metric-bar-chart");
    const labels = JSON.parse(
      chart.getAttribute("data-bar-labels") ?? "[]"
    ) as string[];
    expect(labels).toContain("a");
    expect(labels).toContain("c");
    // The zero row is filtered out
    expect(labels).not.toContain("b");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("renders '(no value)' for empty/null/undefined group values", () => {
    const missing: AggregatedMetricRow[] = [
      { groups: { model: "" }, value: 10 },
      // null/undefined values are not strictly typed by AggregatedMetricRow,
      // but the coercion must still handle them at runtime.
      { groups: { model: null as unknown as string }, value: 20 },
      { groups: { model: undefined as unknown as string }, value: 30 },
    ];
    const { container } = render(<MetricBarChart rows={missing} />);
    const chart = container.querySelector("[data-bar-labels]");
    const labels = JSON.parse(
      chart?.getAttribute("data-bar-labels") ?? "[]"
    ) as string[];
    expect(labels.filter((l) => l === "(no value)")).toHaveLength(3);
  });

  it("renders loading skeleton when isLoading=true", () => {
    render(<MetricBarChart rows={[]} isLoading />);
    expect(screen.getByTestId("metric-bar-chart-loading")).toBeTruthy();
    expect(screen.queryByTestId("metric-bar-chart")).toBeNull();
  });

  it("renders error UI when error is provided", () => {
    render(<MetricBarChart rows={[]} error={new Error("boom")} />);
    const err = screen.getByTestId("metric-bar-chart-error");
    expect(err).toBeTruthy();
    expect(err.textContent).toContain("boom");
  });

  it("renders empty state when rows is empty", () => {
    render(<MetricBarChart rows={[]} />);
    expect(screen.getByTestId("metric-bar-chart-empty")).toBeTruthy();
  });

  it("joins multi-key groupBy labels with ' / '", () => {
    const multi: AggregatedMetricRow[] = [
      { groups: { tool_name: "Bash", decision: "accept" }, value: 42 },
      { groups: { tool_name: "Edit", decision: "reject" }, value: 13 },
    ];
    const { container } = render(<MetricBarChart rows={multi} />);
    // Recharts renders category labels as <text> children with x-axis tick
    // attributes. jsdom collapses inter-word whitespace when reading
    // textContent on SVG <text>, so we read the source attribute (value=)
    // instead of textContent. We expose the labels via a hidden data
    // attribute on the chart root for stable assertions.
    const chart = container.querySelector("[data-bar-labels]");
    const labels = JSON.parse(
      chart?.getAttribute("data-bar-labels") ?? "[]"
    ) as string[];
    expect(labels).toContain("Bash / accept");
    expect(labels).toContain("Edit / reject");
  });
});
