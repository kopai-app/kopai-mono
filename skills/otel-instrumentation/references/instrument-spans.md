| title             | impact   | tags                        |
| ----------------- | -------- | --------------------------- |
| What Earns a Span | CRITICAL | instrument, spans, judgment |

# What Earns a Span

Not every function deserves a span. Two questions decide it:

1. **Interesting?** — does this work meaningfully move latency or failure for the request?
2. **Aggregable?** — grouped by name and attributes, does it produce a useful trend?

Both yes → span. Anything else → an attribute on the span you already have.

## The table

| Operation               | Interesting?                                 | Aggregable?                               | Span?   |
| ----------------------- | -------------------------------------------- | ----------------------------------------- | ------- |
| HTTP request handler    | Yes — variable latency, can fail             | Yes — by route, method, status            | **Yes** |
| Database query          | Yes — I/O bound, failure-prone               | Yes — by query type, table                | **Yes** |
| External API call       | Yes — network latency, someone else's uptime | Yes — by endpoint, status                 | **Yes** |
| Cache lookup            | Yes — fast path vs slow path                 | Yes — by cache name, hit/miss             | **Yes** |
| Queue publish / consume | Yes — async boundary, where delay hides      | Yes — by queue, message type              | **Yes** |
| Business transaction    | Yes — meaningful state change                | Yes — by type, outcome                    | **Yes** |
| Background job          | Yes — runs unattended, fails silently        | Yes — by job name, outcome                | **Yes** |
| Private helper          | No — trivial CPU, predictable                | No — too granular                         | **No**  |
| Loop iteration          | Maybe, if slow                               | No — unbounded cardinality                | **No**  |
| Getter / setter         | No — no meaningful duration                  | No — nothing to group by                  | **No**  |
| Pure-CPU validation     | No — fast and predictable                    | Maybe                                     | **No**  |
| Orchestration wrapper   | No — only calls instrumented code            | No — duration is just the sum of children | **No**  |

The first block is mostly handled by auto-instrumentation. Your judgment is needed for
the business operations underneath, which no SDK can recognise.

## Three ways this goes wrong

**Too many spans.** A trace with thousands of 2ms spans is unreadable and almost never
actionable. Roll them up: one span for the batch, with the detail as attributes on it.
A loop that emits a span per iteration is the classic version of this.

**Too few spans.** A single opaque handler span covering 900ms of work tells you a request
was slow and nothing else. Every gap in the waterfall is a place you'll have to guess.

**Test spans left in.** A span named `test-span`, `debug`, `foo`, or `my-operation` is an
artefact of proving the pipeline worked. Delete it before finishing — `validate-traces.md`
assertion A9 checks for exactly this.

## Prefer attributes to child spans

A child span costs a JOIN to correlate with its parent's context. An attribute on the
parent is immediately available in the same row, groupable alongside everything else on
that request.

So instead of a child span for authentication, time it and record the duration on the
span you already have. Instead of a child span per database call in a loop, count them
and record the total. Both patterns — **timing attributes** and **async request
summaries** — are in `instrument-attributes.md`, with code in
[references/custom-instrumentation.md](../references/custom-instrumentation.md).

Create the child span when you need its own failure status, its own attributes, or its
position in the waterfall. Otherwise widen the parent.

## Span names stay low-cardinality

The name is a grouping key. `GET /api/users/{id}` groups; `GET /api/users/8823` does not —
it creates a new group for every user and makes the data useless in aggregate.

IDs, emails, URLs with parameters, and timestamps belong in attributes, never in names.
`validate-traces.md` assertion A6 checks the route pattern for this.
