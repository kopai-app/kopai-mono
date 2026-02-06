import type { Meta, StoryObj } from "@storybook/react";
import { LogTimeline } from "./index.js";
import { mockLogRows } from "../__fixtures__/logs.js";

const meta: Meta<typeof LogTimeline> = {
  title: "Observability/LogTimeline",
  component: LogTimeline,
  decorators: [
    (Story) => (
      <div style={{ height: "600px" }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof LogTimeline>;

export const Default: Story = { args: { rows: mockLogRows } };
export const Loading: Story = { args: { rows: [], isLoading: true } };
export const Error: Story = {
  args: { rows: [], error: new globalThis.Error("Failed to fetch logs") },
};
export const Empty: Story = { args: { rows: [] } };
