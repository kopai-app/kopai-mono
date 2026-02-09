import type { Meta, StoryObj } from "@storybook/react";
import { Table } from "./index.js";

const meta: Meta<typeof Table> = {
  title: "Dashboard/Table",
  component: Table,
};
export default meta;
type Story = StoryObj<typeof Table>;

export const Default: Story = {
  args: {
    element: {
      props: {
        dataPath: "users",
        columns: [
          { key: "name", label: "Name", format: "text" },
          { key: "status", label: "Status", format: "badge" },
          { key: "amount", label: "Amount", format: "currency" },
        ],
      },
    },
  },
};

export const TwoColumns: Story = {
  args: {
    element: {
      props: {
        dataPath: "items",
        columns: [
          { key: "name", label: "Name", format: "text" },
          { key: "amount", label: "Amount", format: "currency" },
        ],
      },
    },
  },
};
