import { useState, useEffect, useCallback } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import type { denormalizedSignals, dataFilterSchemas } from "@kopai/core";
import { LogTimeline } from "./index.js";
import { LogFilter } from "./LogFilter.js";
import { mockLogRows } from "../__fixtures__/logs.js";

type OtelLogsRow = denormalizedSignals.OtelLogsRow;

const meta: Meta<typeof LogTimeline> = {
  title: "Observability/LogTimeline",
  component: LogTimeline,
  decorators: [
    (Story) => (
      <div style={{ height: "600px" }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof LogTimeline>;

export const Default: Story = { args: { rows: mockLogRows } };
export const Loading: Story = { args: { rows: [], isLoading: true } };
export const Error: Story = {
  args: { rows: [], error: new globalThis.Error("Failed to fetch logs") },
};
export const Empty: Story = { args: { rows: [] } };

// ---------------------------------------------------------------------------
// Live Streaming story
// ---------------------------------------------------------------------------

const SERVICES = ["api-gateway", "auth-service", "user-service"];
const BODIES = [
  "Request received: GET /api/users",
  "User authenticated successfully",
  "Database query completed in 42ms",
  "Cache hit for session token",
  "Response sent: 200 OK",
  "Rate limit check passed",
  "Health check passed",
  "Connection pool: 12/20 active",
  "Retry attempt 1/3 for upstream call",
  "Metrics flush: 256 data points exported",
];
const SEVERITIES: [string, number][] = [
  ["INFO", 9],
  ["DEBUG", 5],
  ["WARN", 13],
  ["ERROR", 17],
];

let nextTs = BigInt(Date.now()) * 1000000n;

function randomRow(): OtelLogsRow {
  nextTs += BigInt(Math.floor(Math.random() * 500 + 10)) * 1000000n;
  const sev = SEVERITIES[Math.floor(Math.random() * SEVERITIES.length)]!;
  return {
    Timestamp: nextTs.toString(),
    Body: BODIES[Math.floor(Math.random() * BODIES.length)]!,
    ServiceName: SERVICES[Math.floor(Math.random() * SERVICES.length)]!,
    SeverityText: sev[0],
    SeverityNumber: sev[1],
  };
}

function LiveStreamingDemo() {
  const [rows, setRows] = useState<OtelLogsRow[]>(() =>
    Array.from({ length: 20 }, () => randomRow())
  );
  const [isLive, setIsLive] = useState(true);

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => {
      const count = Math.floor(Math.random() * 3) + 1;
      const newRows = Array.from({ length: count }, () => randomRow());
      setRows((prev) => {
        const all = [...prev, ...newRows];
        return all.length > 1000 ? all.slice(all.length - 1000) : all;
      });
    }, 2000);
    return () => clearInterval(id);
  }, [isLive]);

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    setIsLive(atBottom);
  }, []);

  return (
    <LogTimeline
      rows={rows}
      streaming={isLive}
      onAtBottomChange={handleAtBottomChange}
    />
  );
}

export const LiveStreaming: Story = {
  render: () => <LiveStreamingDemo />,
};

// ---------------------------------------------------------------------------
// WithFilter story
// ---------------------------------------------------------------------------

function WithFilterDemo() {
  const [filters, setFilters] = useState<
    Partial<dataFilterSchemas.LogsDataFilter>
  >({ limit: 200, sortOrder: "DESC" });
  const [selectedServices, setSelectedServices] = useState<string[]>([]);

  // Client-side filter on the mock data for demo purposes
  const filtered = mockLogRows.filter((row) => {
    if (
      selectedServices.length > 0 &&
      !selectedServices.includes(row.ServiceName ?? "")
    )
      return false;
    if (filters.severityText && row.SeverityText !== filters.severityText)
      return false;
    if (
      filters.bodyContains &&
      !(row.Body ?? "")
        .toLowerCase()
        .includes(filters.bodyContains.toLowerCase())
    )
      return false;
    return true;
  });

  return (
    <div className="flex flex-col" style={{ height: 600 }}>
      <div className="shrink-0 mb-3">
        <LogFilter
          value={filters}
          onChange={setFilters}
          rows={mockLogRows}
          selectedServices={selectedServices}
          onSelectedServicesChange={setSelectedServices}
        />
      </div>
      <div className="flex-1 min-h-0">
        <LogTimeline rows={filtered} />
      </div>
    </div>
  );
}

export const WithFilter: Story = {
  render: () => <WithFilterDemo />,
};
