| title               | impact   | tags                                  |
| ------------------- | -------- | ------------------------------------- |
| Context Propagation | CRITICAL | instrument, context, retrofit, orphan |

# Context Propagation

Context is what connects spans into a trace. When it breaks, nothing errors — the code
compiles, runs, and emits spans, but each one arrives as an **orphan** with no parent,
and the waterfall is a flat list instead of a tree.

Retrofitting OTel into an existing codebase is mostly this. Expect ~60% of the effort
here, not in SDK setup.

`validate-traces.md` assertions A3 and A4 detect the breakage. This rule fixes it.

## Get the right context from your framework

The single biggest source of silent breaks: the framework hands you several context-like
objects and only one carries the OTel span.

| Framework                 | Correct accessor              | Common mistake                                      |
| ------------------------- | ----------------------------- | --------------------------------------------------- |
| Go `net/http`             | `r.Context()`                 | —                                                   |
| Go Fiber v2               | `c.UserContext()`             | `c.Context()` returns the fasthttp context, no span |
| Go Gin                    | `c.Request.Context()`         | Passing `c` itself                                  |
| Go Echo                   | `c.Request().Context()`       | `c` itself                                          |
| Go Chi                    | `r.Context()`                 | —                                                   |
| Python Flask / Django     | automatic (thread-local)      | — with the instrumentation library installed        |
| Node.js Express / Fastify | automatic (AsyncLocalStorage) | — with the instrumentation library installed        |
| Java Spring               | automatic (thread-local)      | Loss across thread pools                            |
| .NET ASP.NET Core         | automatic (`AsyncLocal`)      | —                                                   |
| Ruby Rails                | automatic (thread-local)      | Loss on manually created threads                    |

The Fiber case is worth calling out: `c.Context()` and `c.UserContext()` both compile,
both return a valid context, and only one of them traces. Everything downstream silently
becomes a root span.

## How hard this is, by language

| Language | Difficulty | Why                                                                                                |
| -------- | ---------- | -------------------------------------------------------------------------------------------------- |
| Go       | Hardest    | `context.Context` must be an explicit parameter on every function in the chain                     |
| Java     | Moderate   | Thread-locals propagate within a thread, break across pools, `CompletableFuture`, reactive streams |
| Python   | Easier     | `contextvars` propagate automatically; pain is thread pools and multiprocessing                    |
| Node.js  | Easier     | `AsyncLocalStorage` follows async/await; pain is old callback code                                 |
| Ruby     | Easier     | Thread-local; pain is manual thread creation                                                       |
| .NET     | Easiest    | `Activity` follows async/await via `AsyncLocal<T>`                                                 |

In Go, the refactor is mechanical and wide: add `ctx context.Context` as the first
parameter, thread it from the handler down to every I/O call. Do it in one pass per
call chain rather than partially — a chain that drops context halfway is as broken as
one with none.

## Where it breaks

**Goroutines and threads.** Launching background work with a fresh context detaches it.
Pass the parent context in; if the work outlives the request, use a span link instead of
a parent so a slow job doesn't hold the trace open.

**Loops reusing a parent.** Creating child spans in a loop from the same parent context
is correct. Reassigning the loop variable to the _child_ context makes each iteration a
child of the previous one — a 500-deep chain instead of 500 siblings.

**Thread pools.** Submitting to an executor runs the task on a thread the context never
reached. Java, Python, and Ruby all need the context captured at submit time and attached
inside the task.

**Raw HTTP clients.** Instrumented clients inject the `traceparent` header automatically.
A raw `urllib`/`net/http` call skips it, so the receiving service starts a brand-new
trace and the two halves are never connected.

**Middleware ordering.** OTel middleware registered after the router never sees matched
routes, so `http.route` is empty and spans may not wrap the handler at all. Register it
first, outermost.

Code for each of these:
[references/custom-instrumentation.md](../references/custom-instrumentation.md).

## Retrofit in this order

Each phase is independently deployable and independently verifiable. Run
`drive-traffic.md` plus `validate-traces.md` after each one — do not stack unverified
phases, because the failure modes compound and become hard to attribute.

1. **SDK init and shutdown** — before any code that could create a span. Verify with A1, A2.
2. **HTTP middleware** — highest ROI, zero handler changes. Verify with A5, A6.
3. **Context threading** — the ~60%. Verify with A3, A4.
4. **Custom spans** — I/O boundaries first, then business logic (`instrument-spans.md`).
5. **Logging bridge** — so logs carry trace context (`validate-logs.md`).
6. **Metrics** — bridge existing counters rather than rewriting them (`validate-metrics.md`).

## Verify

```bash
# orphans by name — anything that isn't an entry point is a bug
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --json \
  | jq -r '.[] | select((.parentSpanId // "") == "") | .name' | sort | uniq -c | sort -rn
```

A database, cache, or HTTP-client span appearing as an orphan means context isn't
reaching your data layer. That is this rule's problem, every time.
