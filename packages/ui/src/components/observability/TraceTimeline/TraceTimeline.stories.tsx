import type { Meta, StoryObj } from "@storybook/react";
import { TraceTimeline } from "./index.js";
import { mockTraceRows, mockErrorTraceRows } from "../__fixtures__/traces.js";

const meta: Meta<typeof TraceTimeline> = {
  title: "Observability/TraceTimeline",
  component: TraceTimeline,
  decorators: [
    (Story) => (
      <div style={{ height: "600px" }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof TraceTimeline>;

export const Default: Story = { args: { rows: mockTraceRows } };
export const ErrorTrace: Story = { args: { rows: mockErrorTraceRows } };
export const Loading: Story = { args: { rows: [], isLoading: true } };
export const Error: Story = {
  args: { rows: [], error: new globalThis.Error("Failed to fetch traces") },
};
export const Empty: Story = { args: { rows: [] } };
