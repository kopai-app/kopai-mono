import type { Meta, StoryObj } from "@storybook/react";
import { Divider } from "./index.js";

const meta: Meta<typeof Divider> = {
  title: "Dashboard/Divider",
  component: Divider,
};
export default meta;
type Story = StoryObj<typeof Divider>;

export const Default: Story = {
  args: { element: { props: { label: null } } },
};

export const WithLabel: Story = {
  args: { element: { props: { label: "Section Break" } } },
};
