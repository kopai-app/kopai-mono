import type { Meta, StoryObj } from "@storybook/react";
import { TabBar } from "./index.js";

const meta: Meta<typeof TabBar> = {
  title: "Observability/TabBar",
  component: TabBar,
};
export default meta;
type Story = StoryObj<typeof TabBar>;

export const Default: Story = {
  args: {
    tabs: [
      { key: "services", label: "Services" },
      { key: "logs", label: "Logs" },
      { key: "metrics", label: "Metrics" },
    ],
    active: "services",
  },
};

export const ManyTabs: Story = {
  args: {
    tabs: [
      { key: "overview", label: "Overview" },
      { key: "services", label: "Services" },
      { key: "logs", label: "Logs" },
      { key: "traces", label: "Traces" },
      { key: "metrics", label: "Metrics" },
      { key: "alerts", label: "Alerts" },
    ],
    active: "traces",
  },
};
