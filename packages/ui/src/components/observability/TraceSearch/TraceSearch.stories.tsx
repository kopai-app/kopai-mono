import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TraceSearch } from "./index.js";
import type { SearchFormValues } from "./SearchForm.js";
import { mockTraceSummaries } from "../__fixtures__/trace-summaries.js";

const meta: Meta<typeof TraceSearch> = {
  title: "Observability/TraceSearch",
  component: TraceSearch,
};
export default meta;
type Story = StoryObj<typeof TraceSearch>;

const BASE_FILTERS: SearchFormValues = {
  service: "api-gateway",
  operation: "",
  tags: "",
  lookback: "",
  minDuration: "",
  maxDuration: "",
  limit: 20,
};

const OPERATIONS_BY_SERVICE: Record<string, string[]> = {
  "api-gateway": [
    "GET /api/users",
    "POST /api/users",
    "GET /api/products",
    "PUT /api/users/42",
    "DELETE /api/sessions",
  ],
  checkout: ["POST /checkout", "POST /checkout/pay"],
};

export const Default: Story = {
  args: {
    initialFilters: BASE_FILTERS,
    traces: mockTraceSummaries,
    operations: OPERATIONS_BY_SERVICE["api-gateway"],
  },
};

export const Loading: Story = {
  args: { initialFilters: BASE_FILTERS, traces: [], isLoading: true },
};

export const Error: Story = {
  args: {
    initialFilters: BASE_FILTERS,
    traces: [],
    error: new globalThis.Error("Failed to fetch traces"),
  },
};

export const Empty: Story = {
  args: { initialFilters: BASE_FILTERS, traces: [] },
};

/**
 * The operation picker is scoped to the selected service: it stays disabled
 * until one is chosen, and its options reload on every service change.
 */
export const WithFilters: Story = {
  render: () => {
    const [service, setService] = useState(BASE_FILTERS.service);
    return (
      <TraceSearch
        services={Object.keys(OPERATIONS_BY_SERVICE)}
        initialFilters={BASE_FILTERS}
        operations={OPERATIONS_BY_SERVICE[service] ?? []}
        traces={mockTraceSummaries}
        onSelectTrace={(traceId) => console.log("Select trace:", traceId)}
        onSearch={(filters) => console.log("Search:", filters)}
        onServiceChange={setService}
      />
    );
  },
};
