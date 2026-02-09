import type { Meta, StoryObj } from "@storybook/react";
import { Text } from "./index.js";

const meta: Meta<typeof Text> = {
  title: "Dashboard/Text",
  component: Text,
};
export default meta;
type Story = StoryObj<typeof Text>;

export const Default: Story = {
  args: {
    element: {
      props: {
        content: "Default text content",
        variant: null,
        color: "default",
      },
    },
  },
};

export const Muted: Story = {
  args: {
    element: {
      props: { content: "Muted text content", variant: null, color: "muted" },
    },
  },
};

export const Success: Story = {
  args: {
    element: {
      props: { content: "Success message", variant: null, color: "success" },
    },
  },
};

export const Warning: Story = {
  args: {
    element: {
      props: { content: "Warning message", variant: null, color: "warning" },
    },
  },
};

export const Danger: Story = {
  args: {
    element: {
      props: { content: "Error message", variant: null, color: "danger" },
    },
  },
};
