---
name: root-cause-analysis
description: Analyze telemetry data for root cause analysis using Kopai CLI. Use when debugging errors, investigating latency issues, tracing request flows across services, or correlating logs with traces. Also use when users report production issues like "why is my API slow", "getting 500 errors", "service is down", "requests are timing out", or any symptom that needs telemetry-based investigation — even if they don't mention traces or observability explicitly.
license: Apache-2.0
metadata:
  author: kopai
  version: "1.0.0"
---

# Root Cause Analysis with Kopai

Guide for debugging production issues using telemetry data (traces, logs, metrics) via Kopai CLI.

## Prerequisites

Ensure access to Kopai app backend.
Make sure the services are set up to send their OpenTelemetry data to Kopai.
See otel-instrumentation skill for setup.

## RCA Workflow

1. **Find error traces** — `npx @kopai/cli traces search --status-code ERROR --limit 20 --json`. If empty: broaden time range, check service name, or search logs with `--severity-min 17`
2. **Get full trace context** — `npx @kopai/cli traces get <traceId> --json`. Check Duration, StatusCode, and span hierarchy for bottlenecks
3. **Correlate logs** — `npx @kopai/cli logs search --trace-id <traceId> --json`. Look for error messages, stack traces, and timestamps
4. **Check metrics** — `npx @kopai/cli metrics discover --json` then `npx @kopai/cli metrics search --type <type> --name <name> --json` for anomalies
5. **Present findings** — summarize root cause with evidence (specific traceIds, log entries, metric anomalies), impact, and suggested fix

## Quick Example

```bash
# Find failing requests
npx @kopai/cli traces search --severity-min 17 --service payment-api --json

# Get trace details (copy traceId from above)
npx @kopai/cli traces get abc123def456 --json

# Check correlated logs
npx @kopai/cli logs search --trace-id abc123def456 --severity-min 17 --json
```

## Rules

### 1. Workflow (CRITICAL)

- `workflow-find-errors` - Find Error Traces
- `workflow-get-context` - Get Full Trace Context
- `workflow-correlate-logs` - Correlate Logs with Trace
- `workflow-check-metrics` - Check Related Metrics
- `workflow-identify-cause` - Identify Root Cause & Present Findings

### 2. Patterns (HIGH)

- `pattern-http-errors` - HTTP Error Debugging
- `pattern-slow-requests` - Slow Request Analysis
- `pattern-distributed` - Distributed Failure Tracing
- `pattern-log-driven` - Log-Driven Investigation

Read `rules/<rule-name>.md` for details.

## Tips

1. Always use `--json` for programmatic analysis
2. Pipe to `jq` for filtering/aggregation
3. Start with errors, then trace backwards
4. Check span Duration to find bottlenecks
5. Correlate TraceId across traces, logs, metrics
6. Use `--severity-min 17` instead of `--severity-text ERROR` to catch all error-level logs regardless of text casing. Fall back to `--body "error"` for errors logged at INFO or with no severity.

## References

- [trace-filters](references/trace-filters.md) - Trace search filter options
- [log-filters](references/log-filters.md) - Log search filter options
- [metric-filters](references/metric-filters.md) - Metric search filter options
