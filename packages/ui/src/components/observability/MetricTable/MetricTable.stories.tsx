import type { Meta, StoryObj } from "@storybook/react";
import { MetricTable } from "./index.js";
import { mockGaugeRows } from "../__fixtures__/metrics.js";

const meta: Meta<typeof MetricTable> = {
  title: "Observability/MetricTable",
  component: MetricTable,
};
export default meta;
type Story = StoryObj<typeof MetricTable>;

export const Default: Story = { args: { rows: mockGaugeRows } };
export const CustomColumns: Story = {
  args: { rows: mockGaugeRows, columns: ["metric", "value"] },
};
export const Loading: Story = { args: { rows: [], isLoading: true } };
export const Error: Story = {
  args: { rows: [], error: new globalThis.Error("Failed to fetch metrics") },
};
export const Empty: Story = { args: { rows: [] } };
