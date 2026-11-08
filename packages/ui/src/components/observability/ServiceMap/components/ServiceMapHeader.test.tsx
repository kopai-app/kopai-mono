/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ServiceMapSnapshot } from "../engine/types.js";
import { fixtureSnapshot } from "../test-utils/fixture-snapshot.js";
import {
  ServiceMapHeader,
  diagnosticsText,
  incompleteText,
  scanStatusText,
  summaryText,
} from "./ServiceMapHeader.js";

const one = { id: "api", kind: "service" as const, spans: 42_180 };

function snap(
  over: Parameters<typeof fixtureSnapshot>[1] = {}
): ServiceMapSnapshot {
  return fixtureSnapshot({ nodes: [one], edges: [], hub: "api" }, over);
}

function summary() {
  return screen.getByTestId("sm-summary").textContent ?? "";
}

describe("ServiceMapHeader", () => {
  it("shows spans, coverage and 'scanning older…' while the backward scan runs", () => {
    render(
      <ServiceMapHeader
        snapshot={snap({
          coveredMin: 6,
          scan: { state: "scanning", stopReason: null },
        })}
      />
    );
    expect(summary()).toBe(
      "Service map · past 60 min · built from 42,180 spans · covers 6 of 60 min · scanning older…"
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says why the scan stopped when the request budget ran out, then goes live", () => {
    const { rerender } = render(
      <ServiceMapHeader
        snapshot={snap({
          coveredMin: 6,
          scan: { state: "probing", stopReason: "budget" },
        })}
      />
    );
    expect(summary()).toContain("covers 6 of 60 min");
    expect(summary()).toContain("stopped: request budget reached");
    expect(summary()).toContain("checking unconnected services…");

    rerender(
      <ServiceMapHeader
        snapshot={snap({
          coveredMin: 6,
          scan: { state: "live", stopReason: "budget" },
        })}
      />
    );
    expect(summary()).toBe(
      "Service map · past 60 min · built from 42,180 spans · covers 6 of 60 min · stopped: request budget reached · Live · 30 s delay"
    );
  });

  it("keeps what the scan does now in its own non-shrinking piece, so a narrow window truncates the details first", () => {
    render(
      <ServiceMapHeader
        snapshot={snap({
          coveredMin: 6,
          scan: { state: "live", stopReason: "budget" },
        })}
      />
    );
    const state = screen.getByTestId("sm-scan-state");
    expect(state.textContent).toBe(" · Live · 30 s delay");
    expect(state.className).toContain("shrink-0");
    // The details and the stop reason share the piece that truncates.
    const details = state.previousElementSibling as HTMLElement;
    expect(details.textContent).toBe(
      " · past 60 min · built from 42,180 spans · covers 6 of 60 min · stopped: request budget reached"
    );
    expect(details.className).toContain("text-ellipsis");
    expect(details.className).not.toContain("shrink-0");
  });

  it("shows 'Live · 30 s delay' after full coverage, and 'behind by N s' when the poll lags", () => {
    const { rerender } = render(<ServiceMapHeader snapshot={snap()} />);
    expect(summary()).toBe(
      "Service map · past 60 min · built from 42,180 spans · covers 60 of 60 min · Live · 30 s delay"
    );
    rerender(
      <ServiceMapHeader snapshot={snap({ scan: { behindMs: 42_400 } })} />
    );
    expect(summary()).toContain("Live · behind by 42 s");
    expect(summary()).not.toContain("30 s delay");
  });

  it("says 'Looking for spans…' before the first snapshot and while seeding", () => {
    const { rerender } = render(<ServiceMapHeader snapshot={null} />);
    expect(screen.getByText(/Looking for spans…/)).toBeTruthy();
    rerender(
      <ServiceMapHeader
        snapshot={snap({
          coveredMin: 0,
          scan: { state: "seeding", stopReason: null },
        })}
      />
    );
    expect(summary()).toContain("covers 0 of 60 min");
    expect(summary()).toContain("Looking for spans…");
  });

  it("renders the diagnostics line with every counter", () => {
    render(
      <ServiceMapHeader
        snapshot={snap({
          diagnostics: {
            lateUnpaired: 300,
            clientNoPeer: 12,
            dupes: 18,
            dropped: 0,
            badTimestamp: 0,
          },
        })}
      />
    );
    expect(screen.getByTestId("sm-diagnostics").textContent).toBe(
      "312 calls could not be attributed · 18 duplicate spans skipped · 0 dropped (cap) · 0 bad timestamps"
    );
  });

  it("formats large diagnostics counters with thousands separators", () => {
    expect(
      diagnosticsText(
        snap({ diagnostics: { dropped: 12_345, badTimestamp: 1_002 } })
      )
    ).toBe(
      "0 calls could not be attributed · 0 duplicate spans skipped · 12,345 dropped (cap) · 1,002 bad timestamps"
    );
  });

  it("warns that the map is incomplete when a cap is hit", () => {
    const { rerender } = render(
      <ServiceMapHeader
        snapshot={snap({ diagnostics: { nodeCapHit: true } })}
      />
    );
    expect(
      screen.getAllByTestId("sm-incomplete").map((e) => e.textContent)
    ).toEqual(["Map incomplete: more than 2,000 services"]);

    rerender(<ServiceMapHeader snapshot={snap()} />);
    expect(screen.queryByTestId("sm-incomplete")).toBeNull();

    expect(
      incompleteText(
        snap({
          diagnostics: {
            nodeCapHit: true,
            edgesDropped: 3,
            seedTruncated: true,
          },
        })
      )
    ).toEqual([
      "Map incomplete: more than 2,000 services",
      "Map incomplete: more than 2,500 connections",
      expect.stringMatching(
        /^Map incomplete: the overview query hit its row limit/
      ),
    ]);
  });

  it("shows the error with a Retry button that calls onRetry, and keeps the summary", () => {
    const onRetry = vi.fn();
    render(
      <ServiceMapHeader
        snapshot={snap({
          coveredMin: 6,
          error: "HTTP 503 Service Unavailable",
          scan: { state: "error", stopReason: null },
        })}
        onRetry={onRetry}
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Couldn't load more spans");
    expect(alert.textContent).toContain("HTTP 503");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(summary()).toContain("covers 6 of 60 min");
  });

  it("keeps a fixed height with two single-line rows in every state, so the canvas never moves", () => {
    const states = [
      null,
      snap(),
      snap({ scan: { state: "live", stopReason: "budget" } }),
      snap({ error: "HTTP 503", scan: { state: "error", stopReason: null } }),
      snap({ diagnostics: { nodeCapHit: true, edgesDropped: 3 } }),
    ];
    for (const s of states) {
      const { container, unmount } = render(
        <ServiceMapHeader snapshot={s} hint="a hint" />
      );
      const header = container.querySelector("header")!;
      expect(header.classList).toContain("h-11");
      expect(header.children).toHaveLength(2);
      for (const row of header.children) {
        expect(row.classList).toContain("whitespace-nowrap");
        expect(row.classList).toContain("h-5");
      }
      unmount();
    }
  });

  it("covers the remaining scan states", () => {
    expect(
      scanStatusText(snap({ scan: { state: "paused", stopReason: null } }))
    ).toBe("paused while the tab is hidden");
    expect(
      scanStatusText(
        snap({ scan: { state: "live", stopReason: "no-more-data" } })
      )
    ).toBe("stopped: no older spans · Live · 30 s delay");
    expect(scanStatusText(snap({ scan: { state: "error" } }))).toBeNull();
    expect(
      summaryText(snap({ scan: { state: "idle", stopReason: null } }))
    ).toContain("Looking for spans…");
  });
});
