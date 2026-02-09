import type { Meta, StoryObj } from "@storybook/react";
import { TraceDetail } from "./index.js";
import { mockTraceRows, mockErrorTraceRows } from "../__fixtures__/traces.js";

const meta: Meta<typeof TraceDetail> = {
  title: "Observability/TraceDetail",
  component: TraceDetail,
  decorators: [
    (Story) => (
      <div style={{ height: "600px" }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof TraceDetail>;

export const Default: Story = {
  args: {
    service: "api-gateway",
    traceId: "0af7651916cd43dd8448eb211c80319c",
    rows: mockTraceRows,
  },
};

export const ErrorTrace: Story = {
  args: {
    service: "api-gateway",
    traceId: "1bf8762027de54ee9559fc322d91420d",
    rows: mockErrorTraceRows,
  },
};

export const Loading: Story = {
  args: {
    service: "api-gateway",
    traceId: "0af7651916cd43dd8448eb211c80319c",
    rows: [],
    isLoading: true,
  },
};

export const Error: Story = {
  args: {
    service: "api-gateway",
    traceId: "0af7651916cd43dd8448eb211c80319c",
    rows: [],
    error: new globalThis.Error("Failed to fetch trace"),
  },
};
