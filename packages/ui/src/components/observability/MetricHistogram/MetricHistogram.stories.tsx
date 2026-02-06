import type { Meta, StoryObj } from "@storybook/react";
import { MetricHistogram } from "./index.js";
import { mockHistogramRows } from "../__fixtures__/metrics.js";

const meta: Meta<typeof MetricHistogram> = {
  title: "Observability/MetricHistogram",
  component: MetricHistogram,
};
export default meta;
type Story = StoryObj<typeof MetricHistogram>;

export const Default: Story = { args: { rows: mockHistogramRows } };
export const Loading: Story = { args: { rows: [], isLoading: true } };
export const Error: Story = {
  args: {
    rows: [],
    error: new globalThis.Error("Failed to fetch histogram data"),
  },
};
export const Empty: Story = { args: { rows: [] } };
