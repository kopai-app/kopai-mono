import type { Meta, StoryObj } from "@storybook/react";
import { RawDataTable } from "./index.js";
import { mockRawTableData } from "../__fixtures__/raw-table.js";

const meta: Meta<typeof RawDataTable> = {
  title: "Observability/RawDataTable",
  component: RawDataTable,
};
export default meta;
type Story = StoryObj<typeof RawDataTable>;

export const Default: Story = { args: { data: mockRawTableData } };
export const Truncated: Story = {
  args: { data: mockRawTableData, maxRows: 5 },
};
export const Loading: Story = {
  args: { data: { columns: [], types: [], rows: [] }, isLoading: true },
};
export const Error: Story = {
  args: {
    data: { columns: [], types: [], rows: [] },
    error: new globalThis.Error("Failed to fetch data"),
  },
};
export const Empty: Story = {
  args: { data: { columns: [], types: [], rows: [] } },
};
