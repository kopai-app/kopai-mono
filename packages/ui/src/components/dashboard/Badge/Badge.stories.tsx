import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./index.js";

const meta: Meta<typeof Badge> = {
  title: "Dashboard/Badge",
  component: Badge,
};
export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: { element: { props: { text: "Default", variant: "default" } } },
};

export const Success: Story = {
  args: { element: { props: { text: "Success", variant: "success" } } },
};

export const Warning: Story = {
  args: { element: { props: { text: "Warning", variant: "warning" } } },
};

export const Danger: Story = {
  args: { element: { props: { text: "Danger", variant: "danger" } } },
};

export const Info: Story = {
  args: { element: { props: { text: "Info", variant: "info" } } },
};
