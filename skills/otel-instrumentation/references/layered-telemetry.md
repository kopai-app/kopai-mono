| title             | impact | tags                                       |
| ----------------- | ------ | ------------------------------------------ |
| Layered Telemetry | MEDIUM | instrument, signals, traces, metrics, logs |

# Layered Telemetry

OpenTelemetry is trace-first: context propagation is the glue that correlates every
signal. But traces, metrics, and logs each answer a different question, and emitting all
three for the same event is layering, not duplication — each is a different view at a
different level of detail.

## Which signal

Three questions:

1. **Needs causality and full request context?** → **Traces**. What happened, in what
   order, with everything known about that specific request attached.
2. **Needs cheap long-term storage and fast alerting?** → **Metrics**. Pre-aggregated,
   so they stay cheap for months and evaluate fast — at the cost of losing the individual
   request.
3. **Rare, or required for audit?** → **Logs**. Things too infrequent to aggregate, or
   that must be retained verbatim.

|              | Traces (spans)                    | Metrics                                       | Logs                                           |
| ------------ | --------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| Captures     | Full request context              | Numbers with low-cardinality dimensions       | Text or structured fields                      |
| Discards     | Nothing                           | Individual requests, high-cardinality context | Cross-request correlation, unless trace-linked |
| Query power  | Group and filter on any dimension | Fast aggregates on pre-chosen dimensions      | Search, structured filters                     |
| Cost scaling | Linear with volume                | Explodes with dimension cardinality           | Linear with volume                             |
| Best at      | Investigation, root cause         | Alerting, trends                              | Audit, rare events                             |

The default answer is traces. The same instrumentation effort that produces a metric or
a log line can produce a span — and the span can be counted like a metric, read like a
log, _and_ sliced by dimensions neither can offer.

## Reach for metrics when

- **Alerting.** Evaluating a threshold over a counter is cheaper and faster than
  aggregating spans, and it keeps working when traces are sampled.
- **Long horizons.** Capacity trends over months, where per-request detail is dead weight.
- **Things that aren't requests.** Queue depth, pool utilisation, memory, connection
  counts — state that exists between requests and belongs to no single one.

Keep metric dimensions low-cardinality. A `user.id` label on a counter creates a series
per user; the same field on a span is free. `validate-metrics.md` assertion M4 checks this.

## Reach for logs when

- The event is too rare to aggregate — a config reload, a failover, a migration running
- An audit requirement demands the verbatim record
- The context is a startup or shutdown path where no span is active

Route them through OTel so each record carries trace context. An uncorrelated log is a
line you'll read on its own with no idea what request produced it.
`validate-logs.md` assertion L2 checks the correlation.

## Histograms alongside spans

For a high-throughput HTTP service, emit both a span and a latency histogram per request.

The span gives full context and can be sampled hard for cost. The histogram is
unsampled, cheap, and exact — so alerting stays trustworthy even at 1% trace sampling.
When the histogram fires, the spans are there for the requests that survived sampling.

This is the main case where deliberately emitting the same event twice is correct.

## Don't layer everything

Emitting a metric, a log, _and_ a span for every operation triples the cost and gives you
three places to check that disagree with each other. Layer where the signals do different
jobs — usually alerting (metric) plus investigation (span) on your critical paths — and
let the span carry everything else on its own.
