# Trace Design for Non-Request/Response Architectures

Auto-instrumentation assumes a request comes in, work happens, a response goes out. Queues,
batch jobs, and serverless break that assumption in different ways, and each needs a
deliberate decision about trace shape.

The recurring question: **should this be a child span, a linked span, or its own trace?**

| Situation                                          | Shape                                        |
| -------------------------------------------------- | -------------------------------------------- |
| Work is part of the request and finishes within it | Child span                                   |
| Work originated in a request but outlives it       | New trace, linked                            |
| Work is periodic or unattended                     | Its own trace per run                        |
| Thousands of identical units                       | One span for the batch, counts as attributes |

---

## Queues and message buses

The producer and consumer are separate processes, often separate services, and the gap
between them is where latency hides.

### Propagate context through the message

Inject the trace context into message headers on publish, extract it on consume. Without
this the two halves are unconnected and queue delay is invisible.

```go
// producer
carrier := propagation.MapCarrier{}
otel.GetTextMapPropagator().Inject(ctx, carrier)
msg.Headers = carrier
```

```go
// consumer
parentCtx := otel.GetTextMapPropagator().Extract(context.Background(),
    propagation.MapCarrier(msg.Headers))
```

### Link, don't parent

Parent the consumer span to the producer only if consumption is prompt and bounded.
Otherwise **link** it and start a new trace:

- A message sitting in a queue for an hour would hold its trace open for an hour
- A consumer that retries would attach repeatedly to a long-finished request
- Fan-out to a thousand consumers would produce one unusably wide trace

Linking keeps the causal connection navigable while letting each side be a complete trace
of its own.

### Attribute the wait

Record how long the message waited — it's the number people actually want:

```go
span.SetAttributes(
    attribute.Float64("messaging.queue_time_ms", float64(time.Since(msg.PublishedAt).Milliseconds())),
    attribute.String("messaging.destination", topic),
    attribute.Int("messaging.retry_count", msg.Attempts),
)
```

Follow the OTel `messaging.*` semantic conventions where they apply.

### Alert on the fleet, not the trace

For a pipeline, per-message traces answer "what happened to _this_ message" and are the
wrong tool for "is the pipeline healthy". Emit metrics alongside: consumer lag, queue
depth, processing rate. See `references/layered-telemetry.md`.

---

## Async fan-out and fan-in

One request triggers many parallel units, then waits for them.

**Pattern:** parent span for the coordinating request, child spans for the units, with
the aggregate rolled onto the parent:

```
handle-batch-request
  ├── process-item (×N)
  └── attributes: stats.item_count=250, stats.item_failures=3,
                  stats.slowest_item_ms=840
```

### The million-children hazard

A parent with tens of thousands of children is unusable — it won't render, it's expensive
to store, and no human can read it.

Above roughly a few hundred children, stop creating a span per unit. Instead:

- One span per **batch** of units, with the batch size as an attribute
- Counts, durations, and failure totals rolled onto the parent
  (see [custom-instrumentation.md](custom-instrumentation.md#async-request-summaries))
- Individual spans only for the units that failed or exceeded a threshold — those are
  the ones anyone will look at

You lose per-unit detail for the boring majority. That is the correct trade.

---

## Long-running jobs: ETL and batch

A job running for hours produces a trace that stays open for hours. Most tooling assumes
traces complete in seconds, so you can't see anything until it finishes — which is
exactly when you no longer need to.

### Preferred: one trace per stage

Break the job into stages and give each its own trace, linked to the job:

```
trace 1: etl.extract    (12 min)  job.run_id=abc123
trace 2: etl.transform  (45 min)  job.run_id=abc123
trace 3: etl.load       (8 min)   job.run_id=abc123
```

Each completes and becomes queryable while the job continues, and `job.run_id` ties them
together — a correlation attribute doing the work a single giant trace couldn't.

### Alternative: a wide summary event

If stages are numerous or trivially short, emit a single wide event per run instead:

```
job.name=nightly-rollup
job.run_id=abc123
job.duration_s=3840
job.rows_read=14000000
job.rows_written=13998211
job.rows_rejected=1789
job.stage.extract_s=720
job.stage.transform_s=2700
job.stage.load_s=420
job.outcome=success
```

One row per run, trivially comparable across runs, and it answers "is tonight's job
behaving like last night's" better than any trace.

### Show progress

For anything long-running, emit a heartbeat — a span event or a metric per chunk — so a
hung job is distinguishable from a slow one. Without it, both look like silence.

---

## Serverless

Two constraints dominate: the process freezes when the handler returns, and it may be
cold.

### Flush before returning

Non-negotiable. The runtime freezes the process the moment your handler returns, and the
span buffer freezes with it — those spans arrive on the next invocation, or never.

```javascript
export async function handler(event) {
  try {
    return await doWork(event);
  } finally {
    await provider.forceFlush(); // before returning, always
  }
}
```

### Prefer explicit instrumentation

Auto-instrumentation adds cold-start latency, which you pay per invocation rather than
once per process. In a function doing one thing, a handful of explicit spans usually beats
loading a full auto-instrumentation bundle.

### Propagate across invocations

An event source that isn't HTTP won't carry `traceparent` for you. Put it in the message
payload or attributes explicitly, and extract it on the other side — otherwise every
function in the chain starts its own trace and the pipeline has no shape.

### Attribute the cold start

```javascript
span.setAttributes({
  "faas.coldstart": isColdStart,
  "faas.invocation_id": context.awsRequestId,
  "faas.max_memory_mb": context.memoryLimitInMB,
});
```

`faas.coldstart` is what separates "our p99 is bad" from "our p99 is cold starts" — a
completely different fix.

---

## Cross-cutting: correlation IDs

When a trace can't span the whole flow — a queue boundary you chose not to link, a job
split into per-stage traces, a system you don't control — carry a shared business
identifier on every span instead:

```
order.id=ord_8823    job.run_id=abc123    batch.id=b-2024-11-03
```

It is not a trace, and it doesn't need to be. It's a queryable join key that survives
process boundaries, retries, and days of elapsed time — which is often more than a trace
can offer.
