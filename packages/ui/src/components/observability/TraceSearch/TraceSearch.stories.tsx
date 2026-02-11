import type { Meta, StoryObj } from "@storybook/react";
import { TraceSearch } from "./index.js";
import { mockTraceSummaries } from "../__fixtures__/trace-summaries.js";

const meta: Meta<typeof TraceSearch> = {
  title: "Observability/TraceSearch",
  component: TraceSearch,
};
export default meta;
type Story = StoryObj<typeof TraceSearch>;

export const Default: Story = {
  args: {
    service: "api-gateway",
    traces: mockTraceSummaries,
    operations: [
      "GET /api/users",
      "POST /api/users",
      "GET /api/products",
      "PUT /api/users/42",
      "DELETE /api/sessions",
    ],
  },
};

export const Loading: Story = {
  args: { service: "api-gateway", traces: [], isLoading: true },
};

export const Error: Story = {
  args: {
    service: "api-gateway",
    traces: [],
    error: new globalThis.Error("Failed to fetch traces"),
  },
};

export const Empty: Story = {
  args: { service: "api-gateway", traces: [] },
};

export const WithFilters: Story = {
  args: {
    service: "api-gateway",
    traces: mockTraceSummaries,
    operations: ["GET /api/users", "POST /api/users"],
    onSearch: (filters) => console.log("Search:", filters),
  },
};
