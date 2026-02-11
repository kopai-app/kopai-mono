import type { Meta, StoryObj } from "@storybook/react";
import { Chart } from "./index.js";

const meta: Meta<typeof Chart> = {
  title: "Dashboard/Chart",
  component: Chart,
};
export default meta;
type Story = StoryObj<typeof Chart>;

export const Bar: Story = {
  args: {
    element: {
      props: {
        type: "bar",
        dataPath: "analytics.weekly",
        title: "Weekly Activity",
        height: 150,
      },
    },
  },
};

export const Line: Story = {
  args: {
    element: {
      props: {
        type: "line",
        dataPath: "analytics.daily",
        title: "Daily Trend",
        height: 200,
      },
    },
  },
};

export const NoTitle: Story = {
  args: {
    element: {
      props: {
        type: "area",
        dataPath: "data",
        title: null,
        height: 120,
      },
    },
  },
};
