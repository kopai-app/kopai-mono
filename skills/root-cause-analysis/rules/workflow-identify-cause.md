| title                                          | impact   | tags                                  |
| ---------------------------------------------- | -------- | ------------------------------------- |
| Step 5: Identify Root Cause & Present Findings | CRITICAL | workflow, synthesis, dashboard, step5 |

## Step 5: Identify Root Cause & Present Findings

**Impact:** CRITICAL

Final step in RCA workflow — synthesize findings from steps 1-4, present the analysis, and create a visual dashboard for the user to review.

### 5a. Synthesize Findings

Combine evidence from the previous steps into a coherent narrative:

1. **Timeline** — establish the sequence of events using timestamps from traces and logs
2. **Blast radius** — which services are affected? Use service grouping from error traces
3. **Root vs symptoms** — distinguish the originating failure from cascading effects. The earliest error in the trace chain is usually closest to root cause
4. **Evidence chain** — link specific TraceIds, SpanIds, log entries, and metric anomalies that support the conclusion

### 5b. Present Analysis

Present the root cause analysis to the user with:

- **Summary** — one-sentence root cause statement
- **Evidence** — the specific traces, logs, and metrics that support it
- **Impact** — which services/endpoints are affected and how
- **Suggested fix** — actionable next steps based on the findings

### 5c. Create Incident Dashboard

Use the **create-dashboard** skill to build a dashboard that visualizes the evidence from the analysis. This lets the user visually verify the hypothesis and explore the data themselves.

The dashboard should include:

1. **Relevant metrics** — MetricTimeSeries or MetricStat components for metrics that showed anomalies during the incident (e.g., error rates, latency spikes, resource exhaustion)
2. **Logs** — LogTimeline component filtered to the affected service(s) during the incident timeframe (dataSource method: `searchLogsPage` with `serviceName` param)
3. **Traces** — TraceDetail component showing a representative error trace

After dashboard creation, present the link to the user:

```
<baseUrl>/?tab=metrics&dashboardId=<id>
```

Where `<id>` is from the CLI JSON response and `<baseUrl>` is the `--url` flag value or `http://localhost:8000` if omitted.

### Why create a dashboard?

The raw CLI output gives you the data to analyze, but the user needs to visually review and validate the findings. A dashboard with the relevant signals side-by-side makes it easy to spot patterns, confirm the timeline, and decide on next actions. It also serves as a persistent artifact of the investigation that can be shared with the team.
