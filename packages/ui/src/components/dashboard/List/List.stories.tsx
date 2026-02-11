import type { Meta, StoryObj } from "@storybook/react";
import { List } from "./index.js";

const meta: Meta<typeof List> = {
  title: "Dashboard/List",
  component: List,
};
export default meta;
type Story = StoryObj<typeof List>;

export const Default: Story = {
  render: () => (
    <List element={{ props: { dataPath: "items", emptyMessage: "No items" } }}>
      <div
        style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}
      >
        Item 1
      </div>
      <div
        style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}
      >
        Item 2
      </div>
      <div style={{ padding: "8px 0" }}>Item 3</div>
    </List>
  ),
};

export const Empty: Story = {
  render: () => (
    <List
      element={{ props: { dataPath: "items", emptyMessage: "Nothing here" } }}
    >
      {null}
    </List>
  ),
};
