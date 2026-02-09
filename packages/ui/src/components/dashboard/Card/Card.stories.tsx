import type { Meta, StoryObj } from "@storybook/react";
import { Card } from "./index.js";

const meta: Meta<typeof Card> = {
  title: "Dashboard/Card",
  component: Card,
};
export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: () => (
    <Card
      element={{
        key: "card",
        type: "Card",
        children: [],
        parentKey: "",
        props: {
          title: "Card Title",
          description: "A description",
          padding: "md",
        },
      }}
      hasData={false}
    >
      <p style={{ margin: 0 }}>Card content goes here</p>
    </Card>
  ),
};

export const TitleOnly: Story = {
  render: () => (
    <Card
      element={{
        key: "card",
        type: "Card",
        children: [],
        parentKey: "",
        props: { title: "Title Only", description: null, padding: null },
      }}
      hasData={false}
    >
      <p style={{ margin: 0 }}>Content</p>
    </Card>
  ),
};

export const NoHeader: Story = {
  render: () => (
    <Card
      element={{
        key: "card",
        type: "Card",
        children: [],
        parentKey: "",
        props: { title: null, description: null, padding: "lg" },
      }}
      hasData={false}
    >
      <p style={{ margin: 0 }}>Card without header</p>
    </Card>
  ),
};

export const SmallPadding: Story = {
  render: () => (
    <Card
      element={{
        key: "card",
        type: "Card",
        children: [],
        parentKey: "",
        props: { title: "Compact", description: null, padding: "sm" },
      }}
      hasData={false}
    >
      <p style={{ margin: 0 }}>Small padding</p>
    </Card>
  ),
};
