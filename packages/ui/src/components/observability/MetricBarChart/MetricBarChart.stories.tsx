import type { Meta, StoryObj } from "@storybook/react";
import { MetricBarChart } from "./index.js";
import type { denormalizedSignals } from "@kopai/core";

type AggregatedMetricRow = denormalizedSignals.AggregatedMetricRow;

// Inline mock data — kept local to this story file (do not extend the
// shared fixtures). Numbers come from the Claude Code dashboard PRD §Current
// State so the visuals match what users actually see in their cc env.
const mockCostByModelRows: AggregatedMetricRow[] = [
  { groups: { model: "opus-4-7" }, value: 822.0 },
  { groups: { model: "sonnet-4-6" }, value: 131.0 },
  { groups: { model: "opus[1m]" }, value: 10.0 },
  { groups: { model: "haiku-4-5" }, value: 7.0 },
];

const mockTokenVolumeRows: AggregatedMetricRow[] = [
  { groups: { type: "cacheRead" }, value: 1_546_066_884 },
  { groups: { type: "cacheCreation" }, value: 29_333_420 },
  { groups: { type: "output" }, value: 4_888_000 },
  { groups: { type: "input" }, value: 1_063_000 },
];

const mockManyRows: AggregatedMetricRow[] = [
  { groups: { tool: "Bash" }, value: 412 },
  { groups: { tool: "Edit" }, value: 388 },
  { groups: { tool: "Read" }, value: 256 },
  { groups: { tool: "Write" }, value: 198 },
  { groups: { tool: "Grep" }, value: 142 },
  { groups: { tool: "Glob" }, value: 91 },
  { groups: { tool: "WebFetch" }, value: 72 },
  { groups: { tool: "WebSearch" }, value: 54 },
  { groups: { tool: "Task" }, value: 33 },
  { groups: { tool: "NotebookEdit" }, value: 12 },
];

const meta: Meta<typeof MetricBarChart> = {
  title: "Observability/MetricBarChart",
  component: MetricBarChart,
};
export default meta;
type Story = StoryObj<typeof MetricBarChart>;

export const Default: Story = {
  args: { rows: mockCostByModelRows, unit: "USD", yAxisLabel: "Cost (USD)" },
};

export const Horizontal: Story = {
  args: {
    rows: mockCostByModelRows,
    orientation: "horizontal",
    unit: "USD",
  },
};

export const LogScale: Story = {
  args: {
    rows: mockTokenVolumeRows,
    logScale: true,
    yAxisLabel: "Tokens (log)",
  },
};

export const MaxBars: Story = {
  args: { rows: mockManyRows, maxBars: 5, yAxisLabel: "Tool invocations" },
};

export const Loading: Story = { args: { rows: [], isLoading: true } };

export const Error: Story = {
  args: {
    rows: [],
    error: new globalThis.Error("Failed to load bar chart data"),
  },
};

export const Empty: Story = { args: { rows: [] } };
