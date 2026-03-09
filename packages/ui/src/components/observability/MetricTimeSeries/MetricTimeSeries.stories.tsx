import type { Meta, StoryObj } from "@storybook/react";
import { MetricTimeSeries } from "./index.js";
import {
  mockGaugeRows,
  mockSumRows,
  mockNoAttributeRows,
  mockMultiAttributeRows,
  mockStatRows,
  mockLargeByteRows,
} from "../__fixtures__/metrics.js";

const meta: Meta<typeof MetricTimeSeries> = {
  title: "Observability/MetricTimeSeries",
  component: MetricTimeSeries,
};
export default meta;
type Story = StoryObj<typeof MetricTimeSeries>;

export const Default: Story = { args: { rows: mockGaugeRows } };
export const MultiSeries: Story = {
  args: { rows: [...mockGaugeRows, ...mockSumRows] },
};
export const WithThresholds: Story = {
  args: {
    rows: mockGaugeRows,
    thresholdLines: [
      { value: 80, color: "#ef4444", label: "Max", style: "dashed" },
    ],
  },
};
export const Loading: Story = { args: { rows: [], isLoading: true } };
export const Error: Story = {
  args: { rows: [], error: new globalThis.Error("Failed to fetch metrics") },
};
export const Empty: Story = { args: { rows: [] } };
export const NoAttributes: Story = {
  args: { rows: mockNoAttributeRows },
};
export const MultiAttributes: Story = {
  args: { rows: mockMultiAttributeRows },
};
export const BytesUnit: Story = {
  args: { rows: mockNoAttributeRows, unit: "By" },
};
export const PercentUnit: Story = {
  args: { rows: mockStatRows, unit: "1" },
};
export const GigabyteScale: Story = {
  args: { rows: mockLargeByteRows, unit: "By" },
};
