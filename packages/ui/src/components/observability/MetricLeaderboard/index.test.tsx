/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { denormalizedSignals } from "@kopai/core";
import { MetricLeaderboard } from "./index.js";

type AggregatedMetricRow = denormalizedSignals.AggregatedMetricRow;

const usersRows: AggregatedMetricRow[] = [
  { groups: { "user.email": "alice@example.com" }, value: 100 },
  { groups: { "user.email": "bob@example.com" }, value: 50 },
  { groups: { "user.email": "carol@example.com" }, value: 25 },
  { groups: { "user.email": "dave@example.com" }, value: 10 },
];

function getRows(): HTMLElement[] {
  return Array.from(
    screen
      .getByTestId("metric-leaderboard")
      .querySelectorAll("[data-testid='metric-leaderboard-row']")
  ) as HTMLElement[];
}

describe("MetricLeaderboard", () => {
  it("renders one row per data row", () => {
    render(<MetricLeaderboard rows={usersRows} />);
    expect(getRows()).toHaveLength(usersRows.length);
  });

  it("sorts rows by value DESC", () => {
    const unsorted: AggregatedMetricRow[] = [
      { groups: { user: "low" }, value: 1 },
      { groups: { user: "high" }, value: 100 },
      { groups: { user: "mid" }, value: 50 },
    ];
    render(<MetricLeaderboard rows={unsorted} />);
    const rows = getRows();
    expect(rows[0]!.textContent).toContain("high");
    expect(rows[1]!.textContent).toContain("mid");
    expect(rows[2]!.textContent).toContain("low");
  });

  it("slices to maxRows", () => {
    render(<MetricLeaderboard rows={usersRows} maxRows={3} />);
    expect(getRows()).toHaveLength(3);
  });

  it("prefixes rank #1, #2, #3 in order", () => {
    render(<MetricLeaderboard rows={usersRows} />);
    const rows = getRows();
    expect(
      within(rows[0]!).getByTestId("metric-leaderboard-rank").textContent
    ).toBe("#1");
    expect(
      within(rows[1]!).getByTestId("metric-leaderboard-rank").textContent
    ).toBe("#2");
    expect(
      within(rows[2]!).getByTestId("metric-leaderboard-rank").textContent
    ).toBe("#3");
  });

  it("renders top row bar at 100% width", () => {
    render(<MetricLeaderboard rows={usersRows} />);
    const bar = within(getRows()[0]!).getByTestId("metric-leaderboard-bar");
    expect(bar.style.width).toBe("100%");
  });

  it("renders half-value row bar at 50% width", () => {
    render(<MetricLeaderboard rows={usersRows} />);
    // bob (50) is half of alice (100)
    const bar = within(getRows()[1]!).getByTestId("metric-leaderboard-bar");
    expect(bar.style.width).toBe("50%");
  });

  it("omits bar element when showBar=false", () => {
    render(<MetricLeaderboard rows={usersRows} showBar={false} />);
    expect(screen.queryAllByTestId("metric-leaderboard-bar")).toHaveLength(0);
  });

  it('renders missing group value as "(no value)"', () => {
    const rows: AggregatedMetricRow[] = [
      { groups: { "skill.name": "" }, value: 100 },
      { groups: { "skill.name": "third-party" }, value: 50 },
    ];
    render(<MetricLeaderboard rows={rows} />);
    const renderedRows = getRows();
    expect(
      within(renderedRows[0]!).getByTestId("metric-leaderboard-label")
        .textContent
    ).toBe("(no value)");
  });

  it('joins multi-key group values with " / "', () => {
    const rows: AggregatedMetricRow[] = [
      {
        groups: { "user.email": "alice@example.com", "skill.name": "react" },
        value: 100,
      },
    ];
    render(<MetricLeaderboard rows={rows} />);
    const label = within(getRows()[0]!).getByTestId("metric-leaderboard-label");
    expect(label.textContent).toBe("alice@example.com / react");
  });

  it("renders skeleton when isLoading", () => {
    render(<MetricLeaderboard rows={[]} isLoading />);
    expect(screen.getByTestId("metric-leaderboard-loading")).toBeDefined();
  });

  it("renders error UI when error provided", () => {
    render(
      <MetricLeaderboard rows={[]} error={new globalThis.Error("boom")} />
    );
    const err = screen.getByTestId("metric-leaderboard-error");
    expect(err.textContent).toContain("boom");
  });

  it("renders empty state when no rows", () => {
    render(<MetricLeaderboard rows={[]} />);
    expect(screen.getByTestId("metric-leaderboard-empty")).toBeDefined();
  });
});
