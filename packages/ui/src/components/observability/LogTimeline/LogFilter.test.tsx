/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { LogFilter, type LogFilterProps } from "./LogFilter.js";
import type { denormalizedSignals } from "@kopai/core";

type OtelLogsRow = denormalizedSignals.OtelLogsRow;

// ---------------------------------------------------------------------------
// Mock rows for testing
// ---------------------------------------------------------------------------

const mockRows: OtelLogsRow[] = [
  {
    Timestamp: "1700000000000000000",
    Body: "request received",
    SeverityText: "INFO",
    SeverityNumber: 9,
    ServiceName: "api-gateway",
    ScopeName: "com.example.api",
  },
  {
    Timestamp: "1700000001000000000",
    Body: "auth failed",
    SeverityText: "ERROR",
    SeverityNumber: 17,
    ServiceName: "auth-service",
    ScopeName: "com.example.auth",
  },
  {
    Timestamp: "1700000002000000000",
    Body: "db query",
    SeverityText: "DEBUG",
    SeverityNumber: 5,
    ServiceName: "api-gateway",
    ScopeName: "com.example.api",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(overrides: Partial<LogFilterProps> = {}) {
  const onChange = vi.fn();
  const onSelectedServicesChange = vi.fn();
  const props: LogFilterProps = {
    value: {},
    onChange,
    rows: mockRows,
    selectedServices: [],
    onSelectedServicesChange,
    ...overrides,
  };
  const result = render(<LogFilter {...props} />);
  return { onChange, onSelectedServicesChange, ...result };
}

/** Expand the filter panel (collapsed by default) */
function expand() {
  fireEvent.click(screen.getByTestId("log-filter-toggle"));
}

function getInput(testId: string) {
  return screen.getByTestId(testId) as HTMLInputElement;
}

function getSelect(testId: string) {
  return screen.getByTestId(testId) as HTMLSelectElement;
}

/** Get the last call's first arg from an onChange mock */
function lastCall(fn: ReturnType<typeof vi.fn>) {
  const calls = fn.mock.calls;
  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LogFilter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // -- Rendering ------------------------------------------------------------

  it("starts collapsed by default", () => {
    setup();
    expect(screen.queryByTestId("filter-serviceName")).toBeNull();
  });

  it("renders all filter fields when expanded", () => {
    setup();
    expand();
    expect(screen.getByTestId("filter-serviceName")).toBeDefined();
    expect(screen.getByTestId("filter-severityText")).toBeDefined();
    expect(screen.getByTestId("filter-bodyContains")).toBeDefined();
    expect(screen.getByTestId("filter-sortOrder")).toBeDefined();
    expect(screen.getByTestId("filter-limit")).toBeDefined();
    expect(screen.getByTestId("filter-traceId")).toBeDefined();
    expect(screen.getByTestId("filter-spanId")).toBeDefined();
    expect(screen.getByTestId("filter-scopeName")).toBeDefined();
    expect(screen.getByTestId("filter-logAttributes")).toBeDefined();
    expect(screen.getByTestId("filter-resourceAttributes")).toBeDefined();
    expect(screen.getByTestId("filter-scopeAttributes")).toBeDefined();
    expect(screen.getByTestId("filter-lookback")).toBeDefined();
  });

  // -- Collapsible panel ----------------------------------------------------

  it("collapses and expands the filter panel", () => {
    setup();
    const toggle = screen.getByTestId("log-filter-toggle");

    // Initially collapsed
    expect(screen.queryByTestId("filter-serviceName")).toBeNull();

    // Expand
    fireEvent.click(toggle);
    expect(screen.getByTestId("filter-serviceName")).toBeDefined();

    // Collapse
    fireEvent.click(toggle);
    expect(screen.queryByTestId("filter-serviceName")).toBeNull();
  });

  // -- Filter summary -------------------------------------------------------

  it("shows filter summary when collapsed with active filters", () => {
    setup({
      value: { severityText: "ERROR", limit: 200 },
      selectedServices: ["api-gateway"],
    });
    const summary = screen.getByTestId("filter-summary");
    expect(summary.textContent).toContain("service:api-gateway");
    expect(summary.textContent).toContain("severity:ERROR");
    expect(summary.textContent).toContain("limit:200");
  });

  it("shows multi-service count in summary", () => {
    setup({
      selectedServices: ["api-gateway", "auth-service"],
    });
    const summary = screen.getByTestId("filter-summary");
    expect(summary.textContent).toContain("services:2");
  });

  it("does not show filter summary when no active filters", () => {
    setup({ value: {} });
    expect(screen.queryByTestId("filter-summary")).toBeNull();
  });

  it("hides filter summary when expanded", () => {
    setup({
      selectedServices: ["api-gateway"],
    });
    expect(screen.getByTestId("filter-summary")).toBeDefined();
    expand();
    expect(screen.queryByTestId("filter-summary")).toBeNull();
  });

  // -- Service multi-select -------------------------------------------------

  it("renders service multi-select with options from rows", () => {
    setup();
    expand();
    // Open the dropdown
    fireEvent.click(screen.getByTestId("filter-serviceName-trigger"));
    expect(screen.getByTestId("filter-serviceName-dropdown")).toBeDefined();
    expect(
      screen.getByTestId("filter-serviceName-option-api-gateway")
    ).toBeDefined();
    expect(
      screen.getByTestId("filter-serviceName-option-auth-service")
    ).toBeDefined();
  });

  it("shows 'All' when no services selected", () => {
    setup();
    expand();
    expect(
      screen.getByTestId("filter-serviceName-trigger").textContent
    ).toContain("All");
  });

  it("shows service name when 1 selected", () => {
    setup({ selectedServices: ["api-gateway"] });
    expand();
    expect(
      screen.getByTestId("filter-serviceName-trigger").textContent
    ).toContain("api-gateway");
  });

  it("shows count when multiple selected", () => {
    setup({ selectedServices: ["api-gateway", "auth-service"] });
    expand();
    expect(
      screen.getByTestId("filter-serviceName-trigger").textContent
    ).toContain("2 selected");
  });

  it("toggling a service checkbox calls onSelectedServicesChange", () => {
    const { onSelectedServicesChange } = setup();
    expand();
    fireEvent.click(screen.getByTestId("filter-serviceName-trigger"));
    fireEvent.click(
      screen.getByTestId("filter-serviceName-option-api-gateway")
    );
    expect(onSelectedServicesChange).toHaveBeenCalledWith(["api-gateway"]);
  });

  it("selecting 1 service sets serviceName in onChange", () => {
    const { onChange } = setup();
    expand();
    fireEvent.click(screen.getByTestId("filter-serviceName-trigger"));
    fireEvent.click(
      screen.getByTestId("filter-serviceName-option-api-gateway")
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: "api-gateway" })
    );
  });

  it("selecting 2 services removes serviceName from onChange", () => {
    const { onChange } = setup({
      selectedServices: ["api-gateway"],
    });
    expand();
    fireEvent.click(screen.getByTestId("filter-serviceName-trigger"));
    fireEvent.click(
      screen.getByTestId("filter-serviceName-option-auth-service")
    );
    const call = lastCall(onChange);
    expect(call.serviceName).toBeUndefined();
  });

  it("clearing services removes serviceName from onChange", () => {
    const { onChange, onSelectedServicesChange } = setup({
      selectedServices: ["api-gateway"],
    });
    expand();
    fireEvent.click(screen.getByTestId("filter-serviceName-trigger"));
    fireEvent.click(screen.getByTestId("filter-serviceName-clear"));
    expect(onSelectedServicesChange).toHaveBeenCalledWith([]);
    const call = lastCall(onChange);
    expect(call.serviceName).toBeUndefined();
  });

  // -- Dynamic options from rows --------------------------------------------

  it("renders severity options from rows", () => {
    setup();
    expand();
    const select = getSelect("filter-severityText");
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("INFO");
    expect(options).toContain("ERROR");
    expect(options).toContain("DEBUG");
    expect(options).toContain("");
  });

  it("renders scope options from rows", () => {
    setup();
    expand();
    const select = getSelect("filter-scopeName");
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("com.example.api");
    expect(options).toContain("com.example.auth");
    expect(options).toContain("");
  });

  it("renders empty service multi-select when no rows", () => {
    setup({ rows: [] });
    expand();
    fireEvent.click(screen.getByTestId("filter-serviceName-trigger"));
    // Should show "No options"
    expect(
      screen.getByTestId("filter-serviceName-dropdown").textContent
    ).toContain("No options");
  });

  // -- Select changes fire immediately --------------------------------------

  it("severityText select fires onChange immediately", () => {
    const { onChange } = setup();
    expand();
    const select = getSelect("filter-severityText");

    fireEvent.change(select, { target: { value: "ERROR" } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ severityText: "ERROR" })
    );
  });

  it("scopeName select fires onChange immediately", () => {
    const { onChange } = setup();
    expand();
    const select = getSelect("filter-scopeName");

    fireEvent.change(select, { target: { value: "com.example.api" } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ scopeName: "com.example.api" })
    );
  });

  it("sortOrder select fires onChange immediately", () => {
    const { onChange } = setup({ value: { sortOrder: "DESC" } });
    expand();
    const select = getSelect("filter-sortOrder");

    fireEvent.change(select, { target: { value: "ASC" } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: "ASC" })
    );
  });

  it("clearing severityText removes it from output", () => {
    const { onChange } = setup({ value: { severityText: "ERROR" } });
    expand();
    const select = getSelect("filter-severityText");

    fireEvent.change(select, { target: { value: "" } });

    const call = lastCall(onChange);
    expect(call.severityText).toBeUndefined();
  });

  // -- Text input debounce --------------------------------------------------

  it("bodyContains text input debounces onChange", () => {
    const { onChange } = setup();
    expand();
    const input = getInput("filter-bodyContains");

    fireEvent.change(input, { target: { value: "GET /api" } });
    expect(onChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(500));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ bodyContains: "GET /api" })
    );
  });

  it("traceId text input debounces onChange", () => {
    const { onChange } = setup();
    expand();
    const input = getInput("filter-traceId");

    fireEvent.change(input, { target: { value: "abc123" } });
    expect(onChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(500));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: "abc123" })
    );
  });

  it("spanId text input debounces onChange", () => {
    const { onChange } = setup();
    expand();
    const input = getInput("filter-spanId");

    fireEvent.change(input, { target: { value: "span456" } });
    expect(onChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(500));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ spanId: "span456" })
    );
  });

  it("clearing a text field removes it from output", () => {
    const { onChange } = setup({ value: { bodyContains: "foo" } });
    expand();
    const input = getInput("filter-bodyContains");

    fireEvent.change(input, { target: { value: "" } });
    act(() => vi.advanceTimersByTime(500));

    const call = lastCall(onChange);
    expect(call.bodyContains).toBeUndefined();
  });

  // -- Limit input ----------------------------------------------------------

  it("limit number input fires onChange immediately with valid value", () => {
    const { onChange } = setup();
    expand();
    const input = getInput("filter-limit");

    fireEvent.change(input, { target: { value: "500" } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500 })
    );
  });

  it("limit rejects values outside 1-1000", () => {
    const { onChange } = setup();
    expand();
    const input = getInput("filter-limit");

    fireEvent.change(input, { target: { value: "0" } });

    const call = lastCall(onChange);
    expect(call.limit).toBeUndefined();
  });

  it("limit rejects values above 1000", () => {
    const { onChange } = setup();
    expand();
    const input = getInput("filter-limit");

    fireEvent.change(input, { target: { value: "2000" } });

    const call = lastCall(onChange);
    expect(call.limit).toBeUndefined();
  });

  // -- Attribute parsing ----------------------------------------------------

  it("logAttributes parses key=value correctly", () => {
    const { onChange } = setup();
    expand();
    const input = getInput("filter-logAttributes");

    fireEvent.change(input, { target: { value: "env=prod" } });
    act(() => vi.advanceTimersByTime(500));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ logAttributes: { env: "prod" } })
    );
  });

  it("resourceAttributes parses key=value correctly", () => {
    const { onChange } = setup();
    expand();
    const input = getInput("filter-resourceAttributes");

    fireEvent.change(input, { target: { value: "host=web-01" } });
    act(() => vi.advanceTimersByTime(500));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ resourceAttributes: { host: "web-01" } })
    );
  });

  it("scopeAttributes parses key=value correctly", () => {
    const { onChange } = setup();
    expand();
    const input = getInput("filter-scopeAttributes");

    fireEvent.change(input, { target: { value: "lib=otel" } });
    act(() => vi.advanceTimersByTime(500));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ scopeAttributes: { lib: "otel" } })
    );
  });

  it("attribute input with no '=' does not set the field", () => {
    const { onChange } = setup();
    expand();
    const input = getInput("filter-logAttributes");

    fireEvent.change(input, { target: { value: "no-equals" } });
    act(() => vi.advanceTimersByTime(500));

    const call = lastCall(onChange);
    expect(call.logAttributes).toBeUndefined();
  });

  it("attribute input with empty key does not set the field", () => {
    const { onChange } = setup();
    expand();
    const input = getInput("filter-logAttributes");

    fireEvent.change(input, { target: { value: "=value" } });
    act(() => vi.advanceTimersByTime(500));

    const call = lastCall(onChange);
    expect(call.logAttributes).toBeUndefined();
  });

  it("attribute with value containing '=' parses correctly", () => {
    const { onChange } = setup();
    expand();
    const input = getInput("filter-logAttributes");

    fireEvent.change(input, { target: { value: "query=a=b" } });
    act(() => vi.advanceTimersByTime(500));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ logAttributes: { query: "a=b" } })
    );
  });

  it("multiple comma-separated attributes parse correctly", () => {
    const { onChange } = setup();
    expand();
    const input = getInput("filter-logAttributes");

    fireEvent.change(input, {
      target: { value: "env=prod, region=us-east-1" },
    });
    act(() => vi.advanceTimersByTime(500));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        logAttributes: { env: "prod", region: "us-east-1" },
      })
    );
  });

  it("comma-separated with some invalid entries only parses valid ones", () => {
    const { onChange } = setup();
    expand();
    const input = getInput("filter-logAttributes");

    fireEvent.change(input, {
      target: { value: "env=prod, badentry, region=eu" },
    });
    act(() => vi.advanceTimersByTime(500));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        logAttributes: { env: "prod", region: "eu" },
      })
    );
  });

  // -- Lookback select ------------------------------------------------------

  it("lookback select computes correct nanosecond timestampMin", () => {
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
    const { onChange } = setup();
    expand();
    const select = getSelect("filter-lookback");

    fireEvent.change(select, { target: { value: "0" } });

    const call = lastCall(onChange);
    const expectedMs = Date.now() - 5 * 60_000;
    const expectedNs = String(BigInt(Math.floor(expectedMs)) * 1_000_000n);
    expect(call.timestampMin).toBe(expectedNs);
    expect(call.timestampMax).toBeUndefined();
  });

  it("lookback 'All time' clears timestampMin", () => {
    const { onChange } = setup({ value: { timestampMin: "123" } });
    expand();
    const select = getSelect("filter-lookback");

    fireEvent.change(select, { target: { value: "-1" } });

    const call = lastCall(onChange);
    expect(call.timestampMin).toBeUndefined();
  });

  // -- Time mode switching --------------------------------------------------

  it("switching to absolute mode shows datetime inputs", () => {
    setup();
    expand();
    expect(screen.queryByTestId("filter-timestampMin")).toBeNull();

    fireEvent.click(screen.getByTestId("time-mode-absolute"));

    expect(screen.getByTestId("filter-timestampMin")).toBeDefined();
    expect(screen.getByTestId("filter-timestampMax")).toBeDefined();
  });

  it("switching time modes clears timestamp values", () => {
    const { onChange } = setup({ value: { timestampMin: "123000000000" } });
    expand();

    fireEvent.click(screen.getByTestId("time-mode-absolute"));

    const call = lastCall(onChange);
    expect(call.timestampMin).toBeUndefined();
    expect(call.timestampMax).toBeUndefined();
  });

  it("switching back to lookback clears timestamps", () => {
    const { onChange } = setup({
      value: { timestampMin: "123", timestampMax: "456" },
    });
    expand();

    fireEvent.click(screen.getByTestId("time-mode-absolute"));
    onChange.mockClear();

    fireEvent.click(screen.getByTestId("time-mode-lookback"));

    const call = lastCall(onChange);
    expect(call.timestampMin).toBeUndefined();
    expect(call.timestampMax).toBeUndefined();
  });

  // -- Absolute time inputs -------------------------------------------------

  it("absolute timestampMin sets nanosecond string", () => {
    const { onChange } = setup();
    expand();
    fireEvent.click(screen.getByTestId("time-mode-absolute"));
    onChange.mockClear();

    const input = getInput("filter-timestampMin");
    fireEvent.change(input, { target: { value: "2025-01-15T12:00" } });

    const call = lastCall(onChange);
    const expectedMs = new Date("2025-01-15T12:00").getTime();
    const expectedNs = String(BigInt(Math.floor(expectedMs)) * 1_000_000n);
    expect(call.timestampMin).toBe(expectedNs);
  });

  it("absolute timestampMax sets nanosecond string", () => {
    const { onChange } = setup();
    expand();
    fireEvent.click(screen.getByTestId("time-mode-absolute"));
    onChange.mockClear();

    const input = getInput("filter-timestampMax");
    fireEvent.change(input, { target: { value: "2025-01-15T13:00" } });

    const call = lastCall(onChange);
    const expectedMs = new Date("2025-01-15T13:00").getTime();
    const expectedNs = String(BigInt(Math.floor(expectedMs)) * 1_000_000n);
    expect(call.timestampMax).toBe(expectedNs);
  });

  it("clearing absolute time input removes the field", () => {
    const { onChange } = setup({ value: { timestampMin: "123000000000" } });
    expand();
    fireEvent.click(screen.getByTestId("time-mode-absolute"));
    onChange.mockClear();

    const input = getInput("filter-timestampMin");
    fireEvent.change(input, { target: { value: "" } });

    const call = lastCall(onChange);
    expect(call.timestampMin).toBeUndefined();
  });

  // -- Multiple debounced fields at once ------------------------------------

  it("multiple debounced text fields combine in single onChange", () => {
    const { onChange } = setup();
    expand();

    fireEvent.change(getInput("filter-bodyContains"), {
      target: { value: "error" },
    });
    fireEvent.change(getInput("filter-traceId"), {
      target: { value: "abc" },
    });

    expect(onChange).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(500));

    const combined = lastCall(onChange);
    expect(combined.bodyContains).toBe("error");
    expect(combined.traceId).toBe("abc");
  });

  // -- Preserves non-text values when debounced text fires ------------------

  it("debounced text onChange preserves existing select values", () => {
    const { onChange } = setup({
      value: { severityText: "WARN", sortOrder: "DESC", limit: 100 },
    });
    expand();

    fireEvent.change(getInput("filter-bodyContains"), {
      target: { value: "api" },
    });
    act(() => vi.advanceTimersByTime(500));

    const call = lastCall(onChange);
    expect(call.severityText).toBe("WARN");
    expect(call.sortOrder).toBe("DESC");
    expect(call.limit).toBe(100);
    expect(call.bodyContains).toBe("api");
  });
});
