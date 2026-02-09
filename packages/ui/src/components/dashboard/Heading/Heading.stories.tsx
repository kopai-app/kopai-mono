import type { Meta, StoryObj } from "@storybook/react";
import { Heading } from "./index.js";

const meta: Meta<typeof Heading> = {
  title: "Dashboard/Heading",
  component: Heading,
};
export default meta;
type Story = StoryObj<typeof Heading>;

export const H1: Story = {
  args: { element: { props: { text: "Heading Level 1", level: "h1" } } },
};

export const H2: Story = {
  args: { element: { props: { text: "Heading Level 2", level: "h2" } } },
};

export const H3: Story = {
  args: { element: { props: { text: "Heading Level 3", level: "h3" } } },
};

export const H4: Story = {
  args: { element: { props: { text: "Heading Level 4", level: "h4" } } },
};
