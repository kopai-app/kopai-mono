# Custom Instrumentation Patterns

Full code for the patterns referenced by the rules. Each pattern states what it buys you,
then shows it in Go, Python, and Node.js. Other languages follow the same shape — the
OTel API is deliberately near-identical across SDKs.

- [Attributes on the current span](#attributes-on-the-current-span)
- [Custom spans around business logic](#custom-spans-around-business-logic)
- [Timing attributes](#timing-attributes)
- [Async request summaries](#async-request-summaries)
- [Exception slugs](#exception-slugs)
- [Span events](#span-events)
- [Span links](#span-links)
- [Context propagation fixes](#context-propagation-fixes)

---

## Attributes on the current span

The highest-value, lowest-risk instrumentation there is: no new spans, no restructuring,
just more context on events you already emit.

### Go

```go
func handleCheckout(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    span := trace.SpanFromContext(ctx)

    span.SetAttributes(
        attribute.String("user.id", userID),
        attribute.String("user.type", user.Tier),
        attribute.Int("cart.item_count", len(cart.Items)),
        attribute.Float64("cart.total", cart.Total),
        attribute.Bool("cache.session", sessionFromCache),
    )
    // ...
}
```

### Python

```python
from opentelemetry import trace

def handle_checkout(request):
    span = trace.get_current_span()
    span.set_attribute("user.id", user.id)
    span.set_attribute("user.type", user.tier)
    span.set_attribute("cart.item_count", len(cart.items))
    span.set_attribute("cart.total", cart.total)
    span.set_attribute("cache.session", session_from_cache)
```

### Node.js

```javascript
import { trace } from "@opentelemetry/api";

async function handleCheckout(req, res) {
  const span = trace.getActiveSpan();
  span?.setAttributes({
    "user.id": userId,
    "user.type": user.tier,
    "cart.item_count": cart.items.length,
    "cart.total": cart.total,
    "cache.session": sessionFromCache,
  });
}
```

**Gotchas:** attributes set after `End()` are silently dropped. Values must be primitives
or arrays of primitives — objects are dropped or stringified depending on the SDK. In
Node.js the `?.` quietly hides a missing active span; if attributes never arrive, check
whether the span is recording.

---

## Custom spans around business logic

For operations that are **interesting** and **aggregable** — see `rules/instrument-spans.md`.

### Go

```go
var tracer = otel.Tracer("checkout-service")

func processPayment(ctx context.Context, order *Order) error {
    ctx, span := tracer.Start(ctx, "process-payment")
    defer span.End()

    span.SetAttributes(
        attribute.String("payment.provider", "stripe"),
        attribute.Float64("payment.amount", order.Total),
        attribute.String("payment.currency", order.Currency),
    )

    result, err := stripe.Charge(ctx, order)   // ctx carries the new span
    if err != nil {
        span.SetAttributes(
            attribute.String("exception.slug", "err-stripe-charge-failed"),
            attribute.Bool("error", true),
        )
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
        return err
    }

    span.SetAttributes(attribute.String("payment.result", result.Status))
    return nil
}
```

### Python

```python
tracer = trace.get_tracer("checkout-service")

def process_payment(order):
    with tracer.start_as_current_span("process-payment") as span:
        span.set_attribute("payment.provider", "stripe")
        span.set_attribute("payment.amount", order.total)
        try:
            result = stripe.charge(order)
        except stripe.CardError as e:
            span.set_attribute("exception.slug", "err-stripe-card-declined")
            span.set_attribute("error", True)
            span.record_exception(e)
            span.set_status(StatusCode.ERROR, str(e))
            raise
        span.set_attribute("payment.result", result.status)
```

### Node.js

```javascript
const tracer = trace.getTracer("checkout-service");

async function processPayment(order) {
  return tracer.startActiveSpan("process-payment", async (span) => {
    span.setAttributes({
      "payment.provider": "stripe",
      "payment.amount": order.total,
    });
    try {
      const result = await stripe.charges.create(order);
      span.setAttribute("payment.result", result.status);
      return result;
    } catch (err) {
      span.setAttribute("exception.slug", "err-stripe-charge-failed");
      span.setAttribute("error", true);
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

**Always end the span**, on every path including panics and early returns. Go's
`defer span.End()` right after `Start` is the reliable idiom; in Node.js use `finally`.
An unended span never exports — it looks exactly like missing instrumentation.

---

## Timing attributes

Measure a sub-operation without creating a child span for it. No JOIN, and the duration
sits in the same row as everything else about the request.

### Go

```go
span := trace.SpanFromContext(ctx)

authStart := time.Now()
user, err := authenticate(r)
span.SetAttributes(attribute.Float64("auth.duration_ms",
    float64(time.Since(authStart).Microseconds())/1000.0))

parseStart := time.Now()
payload, err := parseBody(r)
span.SetAttributes(attribute.Float64("payload_parse.duration_ms",
    float64(time.Since(parseStart).Microseconds())/1000.0))
```

### Python

```python
span = trace.get_current_span()

auth_start = time.monotonic()
user = authenticate(request)
span.set_attribute("auth.duration_ms", (time.monotonic() - auth_start) * 1000)
```

### Node.js

```javascript
const span = trace.getActiveSpan();

const authStart = performance.now();
const user = await authenticate(req);
span?.setAttribute("auth.duration_ms", performance.now() - authStart);
```

Use a monotonic clock (`time.monotonic`, `performance.now`, `time.Since`) — wall-clock
time can jump backwards and produce negative durations.

---

## Async request summaries

Roll child-operation statistics onto the parent so pathological requests are visible
without counting spans by hand.

### Go

```go
type RequestStats struct {
    mu                sync.Mutex
    DBQueryCount      int
    DBQueryDurationMS float64
    HTTPCount         int
}

func (s *RequestStats) RecordDBQuery(d time.Duration) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.DBQueryCount++
    s.DBQueryDurationMS += float64(d.Microseconds()) / 1000.0
}

func (s *RequestStats) Apply(span trace.Span) {
    s.mu.Lock()
    defer s.mu.Unlock()
    span.SetAttributes(
        attribute.Int("stats.db_query_count", s.DBQueryCount),
        attribute.Float64("stats.db_query_duration_ms", s.DBQueryDurationMS),
        attribute.Int("stats.http_requests_count", s.HTTPCount),
    )
}

// in the handler, before the span ends:
defer stats.Apply(trace.SpanFromContext(ctx))
```

### Python

```python
from dataclasses import dataclass, field
import threading

@dataclass
class RequestStats:
    db_query_count: int = 0
    db_query_duration_ms: float = 0.0
    http_requests_count: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def record_db_query(self, duration_s: float):
        with self._lock:
            self.db_query_count += 1
            self.db_query_duration_ms += duration_s * 1000

    def apply(self, span):
        with self._lock:
            span.set_attribute("stats.db_query_count", self.db_query_count)
            span.set_attribute("stats.db_query_duration_ms", self.db_query_duration_ms)
            span.set_attribute("stats.http_requests_count", self.http_requests_count)
```

Hook the recording into your database wrapper or middleware so it accumulates without
every call site remembering. Apply to the span just before the request ends.

Guard the counters — concurrent goroutines and threads will race otherwise, and a torn
counter is worse than none.

---

## Exception slugs

A static, hand-assigned identifier per throw site. Greppable, low-cardinality, and
self-auditing: any `error = true` without a slug is an error path nobody instrumented.

### Go

```go
func processPayment(ctx context.Context, order *Order) error {
    span := trace.SpanFromContext(ctx)

    result, err := stripe.Charge(ctx, order)
    if err != nil {
        span.SetAttributes(
            attribute.String("exception.slug", "err-stripe-charge-failed"),  // literal
            attribute.Bool("error", true),
        )
        span.RecordError(err)
        span.SetStatus(codes.Error, err.Error())
        return err
    }

    if !result.Approved {
        span.SetAttributes(
            attribute.String("exception.slug", "err-payment-declined"),
            attribute.Bool("error", true),
            attribute.Bool("exception.expected", true),   // a decline is normal
        )
        return ErrPaymentDeclined
    }
    return nil
}
```

### Python

```python
def process_payment(order):
    span = trace.get_current_span()
    try:
        result = stripe.charge(order)
    except stripe.CardError as e:
        span.set_attribute("exception.slug", "err-stripe-card-error")
        span.set_attribute("error", True)
        span.set_attribute("exception.expected", True)
        span.record_exception(e)
        span.set_status(StatusCode.ERROR, str(e))
        raise
    except stripe.APIError as e:
        span.set_attribute("exception.slug", "err-stripe-api-unavailable")
        span.set_attribute("error", True)
        span.record_exception(e)
        span.set_status(StatusCode.ERROR, str(e))
        raise
```

### Node.js

```javascript
async function processPayment(order) {
  const span = trace.getActiveSpan();
  try {
    const result = await stripe.charges.create(order);
    if (!result.approved) {
      span?.setAttributes({
        "exception.slug": "err-payment-declined",
        error: true,
        "exception.expected": true,
      });
      throw new PaymentDeclinedError();
    }
    return result;
  } catch (err) {
    span?.setAttribute("exception.slug", err.slug ?? "err-stripe-call-failed");
    span?.setAttribute("error", true);
    span?.recordException(err);
    span?.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    throw err;
  }
}
```

**Rules:** string literals only, never interpolated. One per throw site. A consistent
`err-` prefix so they're greppable as a class. Distinct exception types get distinct
slugs — that distinction is the whole value.

**Find the gaps:**

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" \
  --status-code ERROR --json \
  | jq -r '.[] | select(.attributes["exception.slug"] == null) | .name' | sort -u
```

---

## Span events

A timestamped annotation within a span, for a moment that matters but isn't its own
operation.

```go
span.AddEvent("cache.evicted", trace.WithAttributes(
    attribute.String("cache.key_prefix", "session"),
    attribute.Int("cache.evicted_count", n),
))
```

```python
span.add_event("cache.evicted", {"cache.key_prefix": "session", "cache.evicted_count": n})
```

```javascript
span.addEvent("cache.evicted", {
  "cache.key_prefix": "session",
  "cache.evicted_count": n,
});
```

Reach for an event when the _when_ matters within the span. Reach for an attribute when
only the value matters — attributes are easier to query, so prefer them by default.

---

## Span links

Connect spans across separate traces: async processing, fan-in, batch jobs consuming
messages produced by many requests.

### Go

```go
// producer: carry the context into the message
carrier := propagation.MapCarrier{}
otel.GetTextMapPropagator().Inject(ctx, carrier)
msg.Headers = carrier

// consumer: link rather than parent, so a slow batch doesn't hold the trace open
parentCtx := otel.GetTextMapPropagator().Extract(context.Background(),
    propagation.MapCarrier(msg.Headers))
link := trace.LinkFromContext(parentCtx)
ctx, span := tracer.Start(context.Background(), "process-message",
    trace.WithLinks(link))
defer span.End()
```

### Python

```python
ctx = TraceContextTextMapPropagator().extract(carrier=msg.headers)
link = trace.Link(trace.get_current_span(ctx).get_span_context())
with tracer.start_as_current_span("process-message", links=[link]) as span:
    ...
```

**Parent or link?** Parent when the work is part of the same logical request and finishes
within it. Link when it's a separate unit of work that merely originated there — a job
consuming from a queue, a fan-in aggregating many requests. Parenting long async work
produces traces that stay open for hours.

---

## Context propagation fixes

The failures behind `rules/context-propagation.md`.

### Go: threading context

```go
// WRONG — new context, span detached
func (s *Store) GetUser(id string) (*User, error) {
    return s.db.QueryContext(context.Background(), q, id)
}

// RIGHT
func (s *Store) GetUser(ctx context.Context, id string) (*User, error) {
    return s.db.QueryContext(ctx, q, id)
}
```

### Go: Fiber's two contexts

```go
// WRONG — fasthttp context, no OTel span
func handler(c *fiber.Ctx) error {
    return store.GetUser(c.Context(), c.Params("id"))
}

// RIGHT
func handler(c *fiber.Ctx) error {
    return store.GetUser(c.UserContext(), c.Params("id"))
}
```

Both compile. Only one traces.

### Go: goroutines

```go
// WRONG — request context is cancelled when the handler returns
go processAsync(ctx, item)

// RIGHT — detach the deadline, keep the trace linkage
link := trace.LinkFromContext(ctx)
go func() {
    ctx, span := tracer.Start(context.Background(), "process-async",
        trace.WithLinks(link))
    defer span.End()
    processAsync(ctx, item)
}()
```

### Any language: loops

```go
// WRONG — each iteration becomes a child of the previous: a 500-deep chain
for _, item := range items {
    ctx, span := tracer.Start(ctx, "process-item")   // ctx reassigned!
    process(ctx, item)
    span.End()
}

// RIGHT — siblings under one parent
for _, item := range items {
    itemCtx, span := tracer.Start(ctx, "process-item")
    process(itemCtx, item)
    span.End()
}
```

### Python: thread pools

```python
# WRONG — the worker thread has no context
executor.submit(process_item, item)

# RIGHT — capture and reattach
from opentelemetry import context as otel_context

ctx = otel_context.get_current()
def run():
    token = otel_context.attach(ctx)
    try:
        process_item(item)
    finally:
        otel_context.detach(token)
executor.submit(run)
```

### Node.js: callbacks

```javascript
// WRONG — old-style callbacks can break AsyncLocalStorage
db.query(sql, function (err, rows) {
  doWork(rows);
});

// RIGHT — bind the active context
import { context } from "@opentelemetry/api";
const active = context.active();
db.query(sql, (err, rows) => context.with(active, () => doWork(rows)));
```

### Raw HTTP clients

An instrumented client injects `traceparent` automatically. A raw one doesn't, and the
receiving service starts a fresh trace — two disconnected halves of one request.

```go
// RIGHT — otelhttp injects the header
client := http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}
req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
resp, err := client.Do(req)
```

Verify with `validate-traces.md` A3 — a client span appearing as an orphan is this bug.
