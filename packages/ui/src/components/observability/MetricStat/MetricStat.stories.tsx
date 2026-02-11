import type { Meta, StoryObj } from "@storybook/react";
import { MetricStat } from "./index.js";
import { mockStatRows } from "../__fixtures__/metrics.js";

const meta: Meta<typeof MetricStat> = {
  title: "Observability/MetricStat",
  component: MetricStat,
};
export default meta;
type Story = StoryObj<typeof MetricStat>;

export const Default: Story = { args: { rows: mockStatRows } };
export const WithSparkline: Story = {
  args: { rows: mockStatRows, showSparkline: true },
};
export const WithThresholds: Story = {
  args: {
    rows: mockStatRows,
    thresholds: [
      { value: 0.5, color: "green" },
      { value: 0.8, color: "yellow" },
      { value: 1, color: "red" },
    ],
  },
};
export const Loading: Story = { args: { rows: [], isLoading: true } };
export const Error: Story = {
  args: { rows: [], error: new globalThis.Error("Failed to fetch stat") },
};
export const Empty: Story = { args: { rows: [] } };
