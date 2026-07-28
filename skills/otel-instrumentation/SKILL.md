---
name: otel-instrumentation
description: Instrument applications with the OpenTelemetry SDK and prove the telemetry is good by validating it against a local Kopai backend. Use when setting up observability, adding tracing/logging/metrics, deciding what to instrument or which attributes to add, retrofitting OTel into an existing codebase, threading context through call chains, configuring sampling, or when traces/logs/metrics aren't appearing after setup. Also use when users say things like "my traces aren't showing up", "I don't see any data", or "how do I add observability to my app". Do NOT use to investigate existing telemetry for a root cause (use root-cause-analysis), to build dashboards (use create-dashboard), or to instrument LLM and agent calls (use otel-genai-instrumentation).
license: Apache-2.0
metadata:
  author: kopai
  version: "2.0.0"
---

# OpenTelemetry Instrumentation with Kopai

Emit **wide events**, then prove they are good.

A span is a wide event: one flat record carrying the full context of a unit of work.
Kopai runs on localhost, so you never ship instrumentation on faith — you drive traffic
through the app yourself and assert on what arrived. The loop is **green** when every
assertion in `validate-traces` passes. Nothing here is finished while an assertion is red.

## Branches

| You are…                                    | Start at                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| Setting up a service that has no telemetry  | Workflow step 1 below                                                             |
| Retrofitting OTel into an existing codebase | `rules/context-propagation.md` first — it is ~60% of the work — then the workflow |
| Chasing data that isn't arriving            | `rules/troubleshoot-no-data.md`, then step 4 of the workflow                      |

## Workflow

| #   | Step                                                                                                   | Done when                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Start** the backend — `npx @kopai/app start`                                                         | `curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:4318/v1/traces -H 'Content-Type: application/json' -d '{"resourceSpans":[]}'` returns 2xx |
| 2   | **Configure** the environment — `rules/setup-environment.md`                                           | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, and a `validation.run_id` run tag are all exported in the shell that launches the app                  |
| 3   | **Instrument** — `rules/lang-<language>.md` for the SDK, then the judgment rules below                 | The app boots with the SDK loaded and prints no OTel export errors                                                                                         |
| 4   | **Drive** traffic yourself — `rules/drive-traffic.md`                                                  | Every discovered entry point hit at least once **and** at least one deliberate failure driven                                                              |
| 5   | **Assert** — `rules/validate-traces.md`, then `validate-logs`, `validate-metrics`, `validate-shutdown` | Every assertion passes. The loop is **green**                                                                                                              |
| 6   | **Fix** — `rules/troubleshoot-*.md`                                                                    | Return to step 4 and re-drive. Never stop on a red assertion                                                                                               |

Steps 4–6 are a loop, not a sequence. Report the instrumentation complete only when
step 5 is green against traffic you drove in step 4 of the _same_ run.

## What earns a span

Two questions decide it:

1. **Interesting?** — does this work meaningfully move latency or failure for the request?
2. **Aggregable?** — grouped by name and attributes, does it produce a useful trend?

Both yes → create a span. Otherwise → put an **attribute on the span you already have**.

When in doubt, prefer attributes over child spans. An attribute on the parent needs no
JOIN, costs nothing extra to query, and is immediately groupable. Full decision table,
plus the three ways this goes wrong, in `rules/instrument-spans.md`.

## Naming

- **Span names** describe the operation: `GET /api/users`, `db.query SELECT`, `process-payment`
- **Attribute names** are dot-namespaced: `user.id`, `order.total`, `cache.hit`
- **Follow OTel semantic conventions** for anything standard: `http.route`, `db.system`, `rpc.service`
- **Namespace your own** additions: `app.`, `checkout.`, `<company>.`

Span names must be low-cardinality. Never interpolate an ID into a span name — that
belongs in an attribute.

## Rules

Read `rules/<name>.md`.

**Setup** — `setup-backend`, `setup-environment`

**Language SDKs** — `lang-nodejs`, `lang-nextjs`, `lang-python`, `lang-go`, `lang-java`,
`lang-dotnet`, `lang-ruby`, `lang-php`, `lang-rust`, `lang-erlang`, `lang-cpp`

**What to instrument** — `instrument-spans` (what earns a span), `instrument-attributes`
(which attributes, timing attributes, async summaries), `instrument-errors`
(`error`, span status, **slug**), `context-propagation` (threading context; framework
accessor gotchas), `layered-telemetry` (traces vs metrics vs logs), `sampling`

**Prove it** — `drive-traffic` (generate the traffic yourself), `validate-traces`,
`validate-logs`, `validate-metrics`, `validate-shutdown`

**Fix it** — `troubleshoot-no-data`, `troubleshoot-missing-spans`,
`troubleshoot-missing-attrs`, `troubleshoot-wrong-port`

## References

- [attributes](references/attributes.md) — the canonical attribute catalog, by category
- [custom-instrumentation](references/custom-instrumentation.md) — full code for every pattern, per language
- [architectural-patterns](references/architectural-patterns.md) — queues, async fan-out, ETL, serverless
- [cli-reference](references/cli-reference.md) — Kopai CLI commands
- [nextjs-examples](references/nextjs-examples.md) — Next.js instrumentation examples
- [otel-docs](references/otel-docs.md) — OpenTelemetry documentation links

## Related skills

- **otel-genai-instrumentation** — LLM, agent, and tool-call instrumentation
- **root-cause-analysis** — investigating telemetry once it is flowing. Instrument for the
  questions that skill asks: who was affected, what changed, where the time went
- **create-dashboard** — visualising the signals you emit here
