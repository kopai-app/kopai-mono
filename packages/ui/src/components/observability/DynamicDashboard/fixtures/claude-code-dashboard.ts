import type { UITree } from "@kopai/ui-core";

/**
 * Claude Code observability dashboard UITree fixture.
 *
 * Matches the PRD §"Acceptance Criteria — Target Dashboard" mockup. Backed by
 * live data from a kopai backend that has `service=claude-code` telemetry
 * landing. All metric panels read `claude_code.*` Sum metrics; tool-usage
 * panels read aggregated `tool_decision` / `tool_result` log events; the
 * cost-over-time chart uses `searchMetricsTimeSeries` with a 1d bucket.
 *
 * Sections:
 *   1. KPIs        — MetricStat × 9 (cost, sessions, commits, PRs, LOC ± ,
 *                    active cli/user, cache reads/writes)
 *   2. Cost        — MetricTimeSeries (over time by model) + MetricBarChart
 *                    (by model)
 *   3. Tokens      — MetricDonutChart (distribution) + MetricBarChart
 *                    (log scale by type)
 *   4. Attribution — MetricLeaderboard × 3 (top users, by skill, by agent)
 *   5. Tool Usage  — MetricBarChart × 2 (acceptance by tool, most used)
 *   6. Activity    — LogTimeline (claude-code logs)
 *   7. Traces      — TraceDetail (claude-code trace summaries)
 */
export const claudeCodeDashboard = {
  root: "root",
  elements: {
    // ─────────────────────────────────────────────────────────────────────
    // Root container
    // ─────────────────────────────────────────────────────────────────────
    root: {
      key: "root",
      type: "Stack" as const,
      parentKey: "",
      children: [
        "title",
        "kpi-heading",
        "kpi-row-1",
        "kpi-row-2",
        "kpi-row-3",
        "cost-heading",
        "cost-grid",
        "tokens-heading",
        "tokens-grid",
        "attribution-heading",
        "attribution-grid",
        "tool-heading",
        "tool-grid",
        "activity-heading",
        "activity-card",
        "trace-heading",
        "trace-card",
      ],
      props: {
        direction: "vertical" as const,
        gap: "lg" as const,
        align: null,
      },
    },

    title: {
      key: "title",
      type: "Heading" as const,
      parentKey: "root",
      children: [],
      props: { text: "Claude Code Dashboard", level: "h1" as const },
    },

    // ─────────────────────────────────────────────────────────────────────
    // KPIs
    // ─────────────────────────────────────────────────────────────────────
    "kpi-heading": {
      key: "kpi-heading",
      type: "Heading" as const,
      parentKey: "root",
      children: [],
      props: { text: "KPIs", level: "h2" as const },
    },

    "kpi-row-1": {
      key: "kpi-row-1",
      type: "Grid" as const,
      parentKey: "root",
      children: ["kpi-cost", "kpi-sessions", "kpi-commits", "kpi-prs"],
      props: { columns: 4, gap: "md" as const },
    },

    "kpi-cost": {
      key: "kpi-cost",
      type: "MetricStat" as const,
      parentKey: "kpi-row-1",
      children: [],
      props: { label: "Total Cost (USD)", showSparkline: true },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.cost.usage",
          aggregate: "sum" as const,
        },
      },
    },

    "kpi-sessions": {
      key: "kpi-sessions",
      type: "MetricStat" as const,
      parentKey: "kpi-row-1",
      children: [],
      props: { label: "Sessions", showSparkline: true },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.session.count",
          aggregate: "sum" as const,
        },
      },
    },

    "kpi-commits": {
      key: "kpi-commits",
      type: "MetricStat" as const,
      parentKey: "kpi-row-1",
      children: [],
      props: { label: "Commits", showSparkline: true },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.commit.count",
          aggregate: "sum" as const,
        },
      },
    },

    "kpi-prs": {
      key: "kpi-prs",
      type: "MetricStat" as const,
      parentKey: "kpi-row-1",
      children: [],
      props: { label: "Pull Requests", showSparkline: true },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.pull_request.count",
          aggregate: "sum" as const,
        },
      },
    },

    "kpi-loc-added": {
      key: "kpi-loc-added",
      type: "MetricStat" as const,
      parentKey: "kpi-row-2",
      children: [],
      props: { label: "LOC Added", showSparkline: true },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.lines_of_code.count",
          attributes: { type: "added" },
          aggregate: "sum" as const,
        },
      },
    },

    "kpi-row-2": {
      key: "kpi-row-2",
      type: "Grid" as const,
      parentKey: "root",
      children: [
        "kpi-loc-added",
        "kpi-loc-removed",
        "kpi-active-cli",
        "kpi-active-user",
      ],
      props: { columns: 4, gap: "md" as const },
    },

    "kpi-loc-removed": {
      key: "kpi-loc-removed",
      type: "MetricStat" as const,
      parentKey: "kpi-row-2",
      children: [],
      props: { label: "LOC Removed", showSparkline: true },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.lines_of_code.count",
          attributes: { type: "removed" },
          aggregate: "sum" as const,
        },
      },
    },

    "kpi-active-cli": {
      key: "kpi-active-cli",
      type: "MetricStat" as const,
      parentKey: "kpi-row-2",
      children: [],
      props: { label: "Active (CLI, sec)", showSparkline: true },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.active_time.total",
          attributes: { type: "cli" },
          aggregate: "sum" as const,
        },
      },
    },

    "kpi-active-user": {
      key: "kpi-active-user",
      type: "MetricStat" as const,
      parentKey: "kpi-row-2",
      children: [],
      props: { label: "Active (User, sec)", showSparkline: true },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.active_time.total",
          attributes: { type: "user" },
          aggregate: "sum" as const,
        },
      },
    },

    "kpi-cache-reads": {
      key: "kpi-cache-reads",
      type: "MetricStat" as const,
      parentKey: "kpi-row-3",
      children: [],
      props: { label: "Cache Read Tokens", showSparkline: true },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.token.usage",
          attributes: { type: "cacheRead" },
          aggregate: "sum" as const,
        },
      },
    },

    "kpi-row-3": {
      key: "kpi-row-3",
      type: "Grid" as const,
      parentKey: "root",
      children: ["kpi-cache-reads", "kpi-cache-writes"],
      props: { columns: 2, gap: "md" as const },
    },

    "kpi-cache-writes": {
      key: "kpi-cache-writes",
      type: "MetricStat" as const,
      parentKey: "kpi-row-3",
      children: [],
      props: { label: "Cache Creation Tokens", showSparkline: true },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.token.usage",
          attributes: { type: "cacheCreation" },
          aggregate: "sum" as const,
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    // Cost
    // ─────────────────────────────────────────────────────────────────────
    "cost-heading": {
      key: "cost-heading",
      type: "Heading" as const,
      parentKey: "root",
      children: [],
      props: { text: "Cost", level: "h2" as const },
    },

    "cost-grid": {
      key: "cost-grid",
      type: "Grid" as const,
      parentKey: "root",
      children: ["cost-time-card", "cost-by-model-card"],
      props: { columns: 2, gap: "md" as const },
    },

    "cost-time-card": {
      key: "cost-time-card",
      type: "Card" as const,
      parentKey: "cost-grid",
      children: ["cost-time-chart"],
      props: {
        title: "Cost Over Time (by model)",
        description: "Daily USD spend per model",
        padding: "md" as const,
      },
    },

    "cost-time-chart": {
      key: "cost-time-chart",
      type: "MetricTimeSeries" as const,
      parentKey: "cost-time-card",
      children: [],
      props: {
        height: 280,
        showBrush: false,
        yAxisLabel: "USD",
        unit: "USD",
      },
      dataSource: {
        method: "searchMetricsTimeSeries" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.cost.usage",
          aggregate: "sum" as const,
          groupBy: ["model"],
          timeBucket: "1d" as const,
        },
      },
    },

    "cost-by-model-card": {
      key: "cost-by-model-card",
      type: "Card" as const,
      parentKey: "cost-grid",
      children: ["cost-by-model-chart"],
      props: {
        title: "Cost by Model",
        description: "Total USD spend per model (all time)",
        padding: "md" as const,
      },
    },

    "cost-by-model-chart": {
      key: "cost-by-model-chart",
      type: "MetricBarChart" as const,
      parentKey: "cost-by-model-card",
      children: [],
      props: {
        orientation: "horizontal" as const,
        yAxisLabel: null,
        unit: "USD",
        maxBars: 10,
        logScale: false,
      },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.cost.usage",
          aggregate: "sum" as const,
          groupBy: ["model"],
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    // Tokens
    // ─────────────────────────────────────────────────────────────────────
    "tokens-heading": {
      key: "tokens-heading",
      type: "Heading" as const,
      parentKey: "root",
      children: [],
      props: { text: "Tokens", level: "h2" as const },
    },

    "tokens-grid": {
      key: "tokens-grid",
      type: "Grid" as const,
      parentKey: "root",
      children: ["token-donut-card", "token-bar-card"],
      props: { columns: 2, gap: "md" as const },
    },

    "token-donut-card": {
      key: "token-donut-card",
      type: "Card" as const,
      parentKey: "tokens-grid",
      children: ["token-donut"],
      props: {
        title: "Token Distribution",
        description:
          "Proportional split: cacheRead / cacheCreation / output / input",
        padding: "md" as const,
      },
    },

    "token-donut": {
      key: "token-donut",
      type: "MetricDonutChart" as const,
      parentKey: "token-donut-card",
      children: [],
      props: {
        unit: "tokens",
        showLegend: true,
        showLabels: true,
        maxSlices: 6,
      },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.token.usage",
          aggregate: "sum" as const,
          groupBy: ["type"],
        },
      },
    },

    "token-bar-card": {
      key: "token-bar-card",
      type: "Card" as const,
      parentKey: "tokens-grid",
      children: ["token-bar"],
      props: {
        title: "Token Volume (log scale)",
        description: "Absolute counts per type",
        padding: "md" as const,
      },
    },

    "token-bar": {
      key: "token-bar",
      type: "MetricBarChart" as const,
      parentKey: "token-bar-card",
      children: [],
      props: {
        orientation: "horizontal" as const,
        yAxisLabel: null,
        unit: "tokens",
        maxBars: 6,
        logScale: true,
      },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.token.usage",
          aggregate: "sum" as const,
          groupBy: ["type"],
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    // Attribution
    // ─────────────────────────────────────────────────────────────────────
    "attribution-heading": {
      key: "attribution-heading",
      type: "Heading" as const,
      parentKey: "root",
      children: [],
      props: { text: "Attribution", level: "h2" as const },
    },

    "attribution-grid": {
      key: "attribution-grid",
      type: "Grid" as const,
      parentKey: "root",
      children: ["top-users-card", "by-skill-card", "by-agent-card"],
      props: { columns: 3, gap: "md" as const },
    },

    "top-users-card": {
      key: "top-users-card",
      type: "Card" as const,
      parentKey: "attribution-grid",
      children: ["top-users-board"],
      props: {
        title: "Top Users by Cost",
        description: null,
        padding: "md" as const,
      },
    },

    "top-users-board": {
      key: "top-users-board",
      type: "MetricLeaderboard" as const,
      parentKey: "top-users-card",
      children: [],
      props: {
        maxRows: 10,
        unit: "USD",
        showBar: true,
        label: "user.email",
      },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.cost.usage",
          aggregate: "sum" as const,
          groupBy: ["user.email"],
        },
      },
    },

    "by-skill-card": {
      key: "by-skill-card",
      type: "Card" as const,
      parentKey: "attribution-grid",
      children: ["by-skill-board"],
      props: {
        title: "Cost by Skill",
        description: null,
        padding: "md" as const,
      },
    },

    "by-skill-board": {
      key: "by-skill-board",
      type: "MetricLeaderboard" as const,
      parentKey: "by-skill-card",
      children: [],
      props: {
        maxRows: 10,
        unit: "USD",
        showBar: true,
        label: "skill.name",
      },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.cost.usage",
          aggregate: "sum" as const,
          groupBy: ["skill.name"],
        },
      },
    },

    "by-agent-card": {
      key: "by-agent-card",
      type: "Card" as const,
      parentKey: "attribution-grid",
      children: ["by-agent-board"],
      props: {
        title: "Cost by Agent",
        description: null,
        padding: "md" as const,
      },
    },

    "by-agent-board": {
      key: "by-agent-board",
      type: "MetricLeaderboard" as const,
      parentKey: "by-agent-card",
      children: [],
      props: {
        maxRows: 10,
        unit: "USD",
        showBar: true,
        label: "agent.name",
      },
      dataSource: {
        method: "searchAggregatedMetrics" as const,
        params: {
          metricType: "Sum" as const,
          metricName: "claude_code.cost.usage",
          aggregate: "sum" as const,
          groupBy: ["agent.name"],
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    // Tool Usage (from log aggregation)
    // ─────────────────────────────────────────────────────────────────────
    "tool-heading": {
      key: "tool-heading",
      type: "Heading" as const,
      parentKey: "root",
      children: [],
      props: { text: "Tool Usage", level: "h2" as const },
    },

    "tool-grid": {
      key: "tool-grid",
      type: "Grid" as const,
      parentKey: "root",
      children: ["tool-acceptance-card", "tool-usage-card"],
      props: { columns: 2, gap: "md" as const },
    },

    "tool-acceptance-card": {
      key: "tool-acceptance-card",
      type: "Card" as const,
      parentKey: "tool-grid",
      children: ["tool-acceptance-chart"],
      props: {
        title: "Acceptance by Tool",
        description: "tool_decision log events grouped by tool_name × decision",
        padding: "md" as const,
      },
    },

    "tool-acceptance-chart": {
      key: "tool-acceptance-chart",
      type: "MetricBarChart" as const,
      parentKey: "tool-acceptance-card",
      children: [],
      props: {
        orientation: "horizontal" as const,
        yAxisLabel: null,
        unit: null,
        maxBars: 20,
        logScale: false,
      },
      dataSource: {
        method: "searchLogsAggregate" as const,
        params: {
          serviceName: "claude-code",
          logAttributes: { "event.name": "tool_decision" },
          aggregate: "count" as const,
          groupBy: ["tool_name", "decision"],
        },
      },
    },

    "tool-usage-card": {
      key: "tool-usage-card",
      type: "Card" as const,
      parentKey: "tool-grid",
      children: ["tool-usage-chart"],
      props: {
        title: "Most Used Tools",
        description: "tool_result log events grouped by tool_name",
        padding: "md" as const,
      },
    },

    "tool-usage-chart": {
      key: "tool-usage-chart",
      type: "MetricBarChart" as const,
      parentKey: "tool-usage-card",
      children: [],
      props: {
        orientation: "horizontal" as const,
        yAxisLabel: null,
        unit: null,
        maxBars: 15,
        logScale: false,
      },
      dataSource: {
        method: "searchLogsAggregate" as const,
        params: {
          serviceName: "claude-code",
          logAttributes: { "event.name": "tool_result" },
          aggregate: "count" as const,
          groupBy: ["tool_name"],
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    // Activity stream
    // ─────────────────────────────────────────────────────────────────────
    "activity-heading": {
      key: "activity-heading",
      type: "Heading" as const,
      parentKey: "root",
      children: [],
      props: { text: "Activity Stream", level: "h2" as const },
    },

    "activity-card": {
      key: "activity-card",
      type: "Card" as const,
      parentKey: "root",
      children: ["activity-timeline"],
      props: {
        title: null,
        description: "Live log events from service=claude-code",
        padding: "md" as const,
      },
    },

    "activity-timeline": {
      key: "activity-timeline",
      type: "LogTimeline" as const,
      parentKey: "activity-card",
      children: [],
      props: { height: 480 },
      dataSource: {
        method: "searchLogsPage" as const,
        params: {
          serviceName: "claude-code",
          limit: 200,
          sortOrder: "DESC" as const,
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────────
    // Trace explorer
    // ─────────────────────────────────────────────────────────────────────
    "trace-heading": {
      key: "trace-heading",
      type: "Heading" as const,
      parentKey: "root",
      children: [],
      props: { text: "Trace Explorer", level: "h2" as const },
    },

    "trace-card": {
      key: "trace-card",
      type: "Card" as const,
      parentKey: "root",
      children: ["trace-detail"],
      props: {
        title: null,
        description: "Recent claude-code traces — click a row to inspect spans",
        padding: "md" as const,
      },
    },

    "trace-detail": {
      key: "trace-detail",
      type: "TraceDetail" as const,
      parentKey: "trace-card",
      children: [],
      props: { height: 520 },
      dataSource: {
        method: "searchTraceSummariesPage" as const,
        params: {
          serviceName: "claude-code",
          limit: 20,
          sortOrder: "DESC" as const,
        },
      },
    },
  },
} satisfies UITree;
