| title           | impact   | tags                         |
| --------------- | -------- | ---------------------------- |
| Validate Traces | CRITICAL | validate, traces, assertions |

# Validate Traces

Not "did some data show up" — a set of assertions that each pass or fail. The loop is
**green** only when all of them pass against traffic you drove in `drive-traffic.md`
during the _same_ run.

Every command below filters on `validation.run_id`, so it reads only this run's spans.

## Calibrate once

Kopai's JSON shape may differ across versions. Before asserting, look at one span so you
know the real field names:

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --limit 1 --json | jq .
```

The assertions below use OTLP/JSON names — `name`, `traceId`, `spanId`, `parentSpanId`,
`attributes`, `resource`, `status`. **If the output uses different names, substitute
them** in every `jq` filter that follows. Do this once, at the top of the loop.

For assertions richer than `jq` can express comfortably, escalate to `@kopai/sdk` code
mode — the typed query API, `kq`, and `client.query()` are documented in the
**root-cause-analysis** skill. The CLI is the zero-install default.

## A1 — Spans arrived for this run

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --json \
  | jq 'length'
```

**Pass:** greater than zero.
**Fail:** `troubleshoot-no-data.md`. Do not proceed — every assertion below depends on this.

## A2 — The service identifies itself

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --json \
  | jq -r '.. | objects | select(has("service.name")) | ."service.name"' | sort -u
```

**Pass:** exactly your `OTEL_SERVICE_NAME`, and nothing named `unknown_service`.
**Fail:** the resource isn't configured — `setup-environment.md`.

## A3 — Spans are connected, not **orphans**

An orphan is a span with no parent. Entry points are legitimately orphans; anything
downstream of one is a context-propagation bug.

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --json \
  | jq '[.[] | select((.parentSpanId // "") == "")] | length as $orphans
        | "orphans: \($orphans)"'
```

**Pass:** orphans are only your entry-point spans — one per request or job you drove.
**Fail:** if nearly every span is an orphan, context is not propagating —
`context-propagation.md`. This is the most common silent failure in OTel: the code
compiles and runs perfectly the whole time it is happening.

List the orphans by name to see which ones shouldn't be:

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --json \
  | jq -r '.[] | select((.parentSpanId // "") == "") | .name' | sort | uniq -c | sort -rn
```

A database or HTTP-client span in that list is always a bug.

## A4 — Traces have depth

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --json \
  | jq -r 'group_by(.traceId) | map(length)
           | "traces: \(length), spans per trace: min \(min) max \(max)"'
```

**Pass:** a typical request trace has more than one span — handler plus its I/O children.
**Fail:** all single-span traces means auto-instrumentation isn't hooked into your
database and HTTP clients, or context is being dropped. Check that the instrumentation
package for each library is installed, then `context-propagation.md`.

## A5 — Every route you drove shows up

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --json \
  | jq -r '.[].name' | sort -u
```

**Pass:** every entry point from your route sweep appears. Compare against the list you
built in `drive-traffic.md` — this is exhaustive, not a spot check.
**Fail:** a driven route with no span means middleware isn't wired for that path —
`troubleshoot-missing-spans.md`.

## A6 — Entry-point spans carry route context

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" \
  --span-attr "http.route=/api/users" --json | jq 'length'
```

**Pass:** non-zero, and `http.route` holds the route _pattern_ (`/api/users/{id}`), not
the concrete URL (`/api/users/1`). A concrete URL means unbounded cardinality — every
distinct ID becomes its own group and aggregation stops working.
**Fail:** framework middleware is missing, or installed after the router —
`context-propagation.md`.

## A7 — Errors are marked as errors

You drove deliberate failures, so this must return rows.

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" \
  --status-code ERROR --json | jq 'length'
```

**Pass:** roughly the number of failures you drove.
**Fail — zero rows:** the error paths set no span status. The code caught the exception
and returned a 500 while the span reported success. `instrument-errors.md`.

Then check those failures carry a **slug**:

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" \
  --status-code ERROR --json \
  | jq -r '.[] | [.name, (.attributes["exception.slug"] // "NO-SLUG")] | @tsv'
```

**Pass:** no `NO-SLUG` rows — every failure site is greppable and groupable.
**Fail:** each `NO-SLUG` is an error path nobody instrumented — `instrument-errors.md`.

## A8 — The attribute inventory is wide enough

List every attribute key this run produced:

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --json \
  | jq -r '.[].attributes // {} | keys[]' | sort -u
```

Diff that against [references/attributes.md](../references/attributes.md).

**Pass:** the run answers all three questions every investigation opens with — _who was
affected_ (`user.id` or your tenant equivalent), _what changed_ (`service.version` or a
deploy attribute), and _where the time went_ (timing attributes or child spans on the
slow paths). Missing any one of them means the next incident stalls.
**Fail:** `instrument-attributes.md`, then re-drive.

## A9 — No test spans left behind

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --json \
  | jq -r '.[].name' | grep -iE 'test|debug|foo|bar|tmp|xxx' || echo "clean"
```

**Pass:** `clean`. A span created only to prove tracing worked is an artefact — delete it
before finishing.

## Green

Record which assertions passed, and against which `$RUN_ID`. If you changed any
instrumentation to fix a red assertion, mint a new `$RUN_ID`, re-drive, and re-run **all**
assertions — a fix in one place routinely breaks another.

Then continue to `validate-logs.md`, `validate-metrics.md`, and `validate-shutdown.md`.
