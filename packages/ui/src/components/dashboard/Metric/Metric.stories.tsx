import type { Meta, StoryObj } from "@storybook/react";
import { Metric } from "./index.js";

const meta: Meta<typeof Metric> = {
  title: "Dashboard/Metric",
  component: Metric,
};
export default meta;
type Story = StoryObj<typeof Metric>;

export const TrendUp: Story = {
  args: {
    element: {
      props: {
        label: "Total Users",
        valuePath: "1,234",
        format: "number",
        trend: "up",
        trendValue: "12%",
      },
    },
  },
};

export const TrendDown: Story = {
  args: {
    element: {
      props: {
        label: "Bounce Rate",
        valuePath: "23%",
        format: "percent",
        trend: "down",
        trendValue: "5%",
      },
    },
  },
};

export const Neutral: Story = {
  args: {
    element: {
      props: {
        label: "Sessions",
        valuePath: "890",
        format: "number",
        trend: "neutral",
        trendValue: "0%",
      },
    },
  },
};

export const NoTrend: Story = {
  args: {
    element: {
      props: {
        label: "Revenue",
        valuePath: "$45,678",
        format: "currency",
        trend: null,
        trendValue: null,
      },
    },
  },
};
