import type { Meta, StoryObj } from "@storybook/react";
import { Stack } from "./index.js";

const meta: Meta<typeof Stack> = {
  title: "Dashboard/Stack",
  component: Stack,
};
export default meta;
type Story = StoryObj<typeof Stack>;

const StackItem = ({ label }: { label: string }) => (
  <div
    style={{
      padding: 12,
      background: "hsl(var(--card))",
      border: "1px solid hsl(var(--border))",
      borderRadius: "var(--radius)",
    }}
  >
    {label}
  </div>
);

export const Vertical: Story = {
  render: () => (
    <Stack
      element={{
        props: { direction: "vertical", gap: "md", align: "stretch" },
      }}
    >
      <StackItem label="Item 1" />
      <StackItem label="Item 2" />
      <StackItem label="Item 3" />
    </Stack>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <Stack
      element={{
        props: { direction: "horizontal", gap: "md", align: "center" },
      }}
    >
      <StackItem label="Item 1" />
      <StackItem label="Item 2" />
      <StackItem label="Item 3" />
    </Stack>
  ),
};

export const SmallGap: Story = {
  render: () => (
    <Stack
      element={{ props: { direction: "vertical", gap: "sm", align: "start" } }}
    >
      <StackItem label="Item 1" />
      <StackItem label="Item 2" />
    </Stack>
  ),
};
