import type { Meta, StoryObj } from "@storybook/react";
import { Empty } from "./index.js";

const meta: Meta<typeof Empty> = {
  title: "Dashboard/Empty",
  component: Empty,
};
export default meta;
type Story = StoryObj<typeof Empty>;

export const Default: Story = {
  args: {
    element: {
      props: {
        title: "No Data Available",
        description: "Try adjusting your filters or adding new data.",
        action: "addData",
        actionLabel: "Add Data",
      },
    },
  },
};

export const NoAction: Story = {
  args: {
    element: {
      props: {
        title: "Nothing Here",
        description: "Check back later.",
        action: null,
        actionLabel: null,
      },
    },
  },
};

export const TitleOnly: Story = {
  args: {
    element: {
      props: {
        title: "Empty",
        description: null,
        action: null,
        actionLabel: null,
      },
    },
  },
};
