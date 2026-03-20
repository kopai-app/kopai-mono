---
name: create-dashboard
description: Create observability dashboards from OTEL metrics, logs, and traces using Kopai. Use when building metric visualizations, monitoring views, KPI panels, or when the user wants to see their telemetry data in a dashboard — even if they don't say "dashboard" explicitly. Also use when other skills or workflows need to present telemetry data visually (e.g. after root cause analysis).
license: Apache-2.0
metadata:
  author: kopai
  version: "1.0.0"
---

# Create Dashboard with Kopai

## Component Schema (auto-generated)

!`npx @kopai/cli dashboards schema 2>/dev/null || echo "ERROR: Cannot connect to Kopai backend. If running locally, start it with: npx @kopai/app start — If using a remote backend, check the url in your .kopairc file."`

## Available Metrics

!`npx @kopai/cli metrics discover --json 2>/dev/null || echo "ERROR: Cannot connect to Kopai backend. If running locally, start it with: npx @kopai/app start — If using a remote backend, check the url in your .kopairc file."`

## Rules

- `workflow` - Dashboard creation workflow

Read `rules/<rule-name>.md` for details.
