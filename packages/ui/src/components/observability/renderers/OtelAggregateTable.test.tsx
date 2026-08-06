/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { render, waitFor, screen } from "@testing-library/react";
import { DynamicDashboard, type UITree } from "../DynamicDashboard/index.js";
import { queryClient } from "@kopai/ui-core";
import { kq } from "@kopai/sdk";

// A real aggregate query — top span names by call count. Built with `kq` so the
// uiTree's KopaiQuery schema validation exercises the same shape a dashboard
// author would produce.
const aggQuery = kq.traces
  .aggregate()
  .dimension("SpanName")
  .measure((m) => m.count("calls"))
  .measure((m) => m.avg("Duration", "avg_duration"))
  .timeRelative("1h")
  .summary()
  .build();

function treeWith(
  units: Record<string, string> | null = null,
  labels: Record<string, string> | null = null
): UITree {
  return {
    root: "agg",
    elements: {
      agg: {
        key: "agg",
        type: "AggregateTable" as const,
        children: [],
        parentKey: "",
        props: { maxRows: 10, units, labels },
        dataSource: { method: "query" as const, params: aggQuery },
      },
    },
  } satisfies UITree;
}

function clientReturning(data: unknown) {
  return { query: vi.fn().mockResolvedValue(data) } as never;
}

describe("OtelAggregateTable", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("renders dimension + measure columns from aggregate rows", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({
          data: [
            { SpanName: "trpc.uploadLogo", calls: 42, avg_duration: 2090.5 },
            { SpanName: "GET /health", calls: 1200, avg_duration: 3 },
          ],
        }),
        uiTree: treeWith(),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table")).toBeTruthy();
    });
    // Columns derived from the rows, in first-seen order, humanised.
    expect(screen.getByText("Span Name")).toBeTruthy();
    expect(screen.getByText("Calls")).toBeTruthy();
    expect(screen.getByText("Avg Duration")).toBeTruthy();
    // Values: strings verbatim, numbers scale-formatted by RawDataTable.
    expect(screen.getByText("trpc.uploadLogo")).toBeTruthy();
    expect(screen.getByText("1.20K")).toBeTruthy();
  });

  it("surfaces an explicit error when a RAW result is bound here", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({
          data: [
            { TimeUnix: "2024-01-01T00:00:00Z", Value: 1, Attributes: {} },
          ],
          nextCursor: null,
        }),
        uiTree: treeWith(),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table-error")).toBeTruthy();
    });
    expect(screen.getByText(/aggregate-mode query/)).toBeTruthy();
  });

  it("shows the empty state, not an error, for a zero-row aggregate", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({ data: [] }),
        uiTree: treeWith(),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table-empty")).toBeTruthy();
    });
  });

  // OTel span Duration is stored in nanoseconds, so an unannotated AVG(Duration)
  // renders as "23.07M" — digits that happen to match the millisecond value,
  // which is exactly what makes the generic SI suffix misleading.
  it("renders a ns-annotated column as a duration instead of SI-scaled", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({
          data: [
            { SpanName: "process expire", calls: 12, avg_duration: 23070000 },
          ],
        }),
        uiTree: treeWith({ avg_duration: "ns" }),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table")).toBeTruthy();
    });
    expect(screen.getByText("23.07 ms")).toBeTruthy();
    expect(screen.queryByText("23.07M")).toBeNull();
    // Unannotated columns keep the generic formatting.
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("walks the duration ladder from ns up to hours", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({
          data: [
            { SpanName: "sub-microsecond", calls: 1, avg_duration: 823 },
            { SpanName: "micros", calls: 2, avg_duration: 4500 },
            { SpanName: "millis", calls: 3, avg_duration: 8080000 },
            { SpanName: "seconds", calls: 4, avg_duration: 1397820000 },
            { SpanName: "minutes", calls: 5, avg_duration: 90e9 },
            { SpanName: "hours", calls: 6, avg_duration: 7200e9 },
          ],
        }),
        uiTree: treeWith({ avg_duration: "ns" }),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table")).toBeTruthy();
    });
    expect(screen.getByText("823 ns")).toBeTruthy();
    expect(screen.getByText("4.50 μs")).toBeTruthy();
    expect(screen.getByText("8.08 ms")).toBeTruthy();
    expect(screen.getByText("1.40 s")).toBeTruthy();
    expect(screen.getByText("1.50 min")).toBeTruthy();
    // Whole numbers below 1e4 skip the decimals rather than reading "2.00 h".
    expect(screen.getByText("2 h")).toBeTruthy();
  });

  it("normalises non-ns duration units before formatting", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({
          data: [{ SpanName: "in millis", calls: 1, avg_duration: 1500 }],
        }),
        uiTree: treeWith({ avg_duration: "ms" }),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table")).toBeTruthy();
    });
    expect(screen.getByText("1.50 s")).toBeTruthy();
  });

  // Decimal, not binary — this is the shared resolver the charts use, so a
  // byte count reads the same in a table as in a MetricStat.
  it("formats a By-annotated column on the byte ladder", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({
          data: [
            { SpanName: "small", calls: 1, avg_duration: 512 },
            { SpanName: "large", calls: 2, avg_duration: 5 * 1024 * 1024 },
          ],
        }),
        uiTree: treeWith({ avg_duration: "By" }),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table")).toBeTruthy();
    });
    expect(screen.getByText("512 B")).toBeTruthy();
    expect(screen.getByText("5.24 MB")).toBeTruthy();
  });

  // Inherited from the shared resolver: OTel's dimensionless unit is a ratio.
  it("renders a '1'-annotated ratio column as a percentage", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({
          data: [
            { SpanName: "failing", calls: 12, error_rate: 1 },
            { SpanName: "partial", calls: 50, error_rate: 0.42 },
          ],
        }),
        uiTree: treeWith({ error_rate: "1" }),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table")).toBeTruthy();
    });
    expect(screen.getByText("100.00%")).toBeTruthy();
    expect(screen.getByText("42.00%")).toBeTruthy();
  });

  it("scales an unknown unit generically and appends it", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({
          data: [
            { SpanName: "dimensionless", calls: 1, avg_duration: 2500000 },
          ],
        }),
        uiTree: treeWith({ avg_duration: "{spans}" }),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table")).toBeTruthy();
    });
    expect(screen.getByText("2.50 M spans")).toBeTruthy();
  });

  it("humanises snake_case, dotted and PascalCase headers", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({
          data: [
            {
              "service.name": "bova-worker",
              SpanName: "process expire",
              calls: 1,
              error_rate: 0,
            },
          ],
        }),
        uiTree: treeWith(),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table")).toBeTruthy();
    });
    expect(screen.getByText("Service Name")).toBeTruthy();
    expect(screen.getByText("Span Name")).toBeTruthy();
    expect(screen.getByText("Error Rate")).toBeTruthy();
  });

  // The unit moved into the cell, so restating it in the header is noise.
  it("drops a trailing unit token from a unit-annotated header", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({
          data: [
            { SpanName: "process expire", calls: 1, avg_duration_ns: 8080000 },
          ],
        }),
        uiTree: treeWith({ avg_duration_ns: "ns" }),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table")).toBeTruthy();
    });
    expect(screen.getByText("Avg Duration")).toBeTruthy();
    expect(screen.queryByText("Avg Duration Ns")).toBeNull();
    expect(screen.getByText("8.08 ms")).toBeTruthy();
  });

  // Dropping a suffix the values contradict would relabel the column with a
  // lie, so the drop only fires when name and annotation agree.
  it("keeps a trailing unit token that disagrees with the annotated unit", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({
          data: [{ SpanName: "x", calls: 1, avg_duration_ms: 1500 }],
        }),
        uiTree: treeWith({ avg_duration_ms: "ns" }),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table")).toBeTruthy();
    });
    expect(screen.getByText("Avg Duration Ms")).toBeTruthy();
  });

  it("keeps a unit-suffixed name when the column has no unit annotation", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({
          data: [{ SpanName: "x", calls: 1, avg_duration_ns: 8080000 }],
        }),
        uiTree: treeWith(),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table")).toBeTruthy();
    });
    expect(screen.getByText("Avg Duration Ns")).toBeTruthy();
  });

  it("keeps acronym runs whole when humanising", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({
          data: [{ HTTPRoute: "/health", p95: 3, calls: 1 }],
        }),
        uiTree: treeWith(),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table")).toBeTruthy();
    });
    expect(screen.getByText("HTTP Route")).toBeTruthy();
    expect(screen.getByText("P95")).toBeTruthy();
  });

  // Humanising mangles dotted OTel attribute names; `labels` is the way out.
  it("lets an explicit label override the humanised header", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({
          data: [
            {
              "SpanAttributes.http.route": "/health",
              calls: 1,
              avg_duration_ns: 8080000,
            },
          ],
        }),
        uiTree: treeWith(
          { avg_duration_ns: "ns" },
          { "SpanAttributes.http.route": "Route", calls: "Requests" }
        ),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table")).toBeTruthy();
    });
    expect(screen.getByText("Route")).toBeTruthy();
    expect(screen.getByText("Requests")).toBeTruthy();
    expect(screen.queryByText("Span Attributes Http Route")).toBeNull();
    // Columns absent from `labels` still humanise.
    expect(screen.getByText("Avg Duration")).toBeTruthy();
  });

  // Aliases are hand-written, so a units map will drift from the query it
  // annotates. A stale entry must not shift the remaining columns' formatting,
  // which is the failure mode of mapping units positionally instead of by name.
  it("tolerates a units map that names a column the query does not return", async () => {
    render(
      createElement(DynamicDashboard, {
        kopaiClient: clientReturning({
          data: [
            { SpanName: "process expire", calls: 1200, avg_duration: 8080000 },
          ],
        }),
        uiTree: treeWith({ renamed_duration: "ns", avg_duration: "ns" }),
      })
    );

    await waitFor(() => {
      expect(screen.getByTestId("raw-data-table")).toBeTruthy();
    });
    expect(screen.getByText("8.08 ms")).toBeTruthy();
    // `calls` is unannotated and must stay SI-scaled, not absorb a unit.
    expect(screen.getByText("1.20K")).toBeTruthy();
  });
});
