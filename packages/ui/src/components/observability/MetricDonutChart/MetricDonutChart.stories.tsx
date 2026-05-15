import type { Meta, StoryObj } from "@storybook/react";
import { MetricDonutChart } from "./index.js";
import type { denormalizedSignals } from "@kopai/core";

type AggregatedMetricRow = denormalizedSignals.AggregatedMetricRow;

// Claude Code token distribution (PRD §Current State)
const mockTokenDistributionRows: AggregatedMetricRow[] = [
  { groups: { type: "cacheRead" }, value: 1_546_066_884 },
  { groups: { type: "cacheCreation" }, value: 29_333_420 },
  { groups: { type: "output" }, value: 4_888_000 },
  { groups: { type: "input" }, value: 1_063_000 },
];

const mockManyRows: AggregatedMetricRow[] = [
  { groups: { tool: "Read" }, value: 5_400 },
  { groups: { tool: "Edit" }, value: 4_100 },
  { groups: { tool: "Bash" }, value: 3_200 },
  { groups: { tool: "Glob" }, value: 1_800 },
  { groups: { tool: "Grep" }, value: 1_500 },
  { groups: { tool: "Write" }, value: 900 },
  { groups: { tool: "Task" }, value: 400 },
  { groups: { tool: "WebFetch" }, value: 150 },
];

const meta: Meta<typeof MetricDonutChart> = {
  title: "Observability/MetricDonutChart",
  component: MetricDonutChart,
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof MetricDonutChart>;

export const Default: Story = {
  args: { rows: mockTokenDistributionRows, unit: "{tokens}" },
};

export const WithOther: Story = {
  args: {
    rows: mockManyRows,
    maxSlices: 4,
    unit: "{calls}",
  },
};

export const NoLegend: Story = {
  args: {
    rows: mockTokenDistributionRows,
    showLegend: false,
    unit: "{tokens}",
  },
};

export const Loading: Story = {
  args: { rows: [], isLoading: true },
};

export const Error: Story = {
  args: { rows: [], error: new globalThis.Error("Failed to load donut") },
};

export const Empty: Story = { args: { rows: [] } };
