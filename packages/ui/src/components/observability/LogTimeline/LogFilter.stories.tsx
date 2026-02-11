import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import type { dataFilterSchemas } from "@kopai/core";
import { LogFilter } from "./LogFilter.js";
import { mockLogRows } from "../__fixtures__/logs.js";

type LogsDataFilter = dataFilterSchemas.LogsDataFilter;

const meta: Meta<typeof LogFilter> = {
  title: "Observability/LogFilter",
  component: LogFilter,
  decorators: [
    (Story) => (
      <div style={{ width: 800 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof LogFilter>;

function Controlled(
  initial: Partial<LogsDataFilter>,
  initialServices: string[] = []
) {
  return function Render() {
    const [value, setValue] = useState<Partial<LogsDataFilter>>(initial);
    const [selectedServices, setSelectedServices] =
      useState<string[]>(initialServices);
    return (
      <div className="space-y-4">
        <LogFilter
          value={value}
          onChange={setValue}
          rows={mockLogRows}
          selectedServices={selectedServices}
          onSelectedServicesChange={setSelectedServices}
        />
        <pre className="text-xs text-muted-foreground bg-muted/50 p-3 rounded overflow-auto">
          {JSON.stringify(
            { ...value, _selectedServices: selectedServices },
            null,
            2
          )}
        </pre>
      </div>
    );
  };
}

export const Default: Story = {
  render: Controlled({}),
};

export const WithValues: Story = {
  render: Controlled(
    {
      severityText: "ERROR",
      bodyContains: "timeout",
      limit: 200,
      sortOrder: "DESC",
    },
    ["api-gateway"]
  ),
};
