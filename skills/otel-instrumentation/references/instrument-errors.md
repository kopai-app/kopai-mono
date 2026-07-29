| title  | impact   | tags                             |
| ------ | -------- | -------------------------------- |
| Errors | CRITICAL | instrument, errors, slug, status |

# Errors

A failed request that produced a successful-looking span is worse than no telemetry:
it makes the dashboard say everything is fine while users are getting 500s. Error
instrumentation is what the **root-cause-analysis** skill consumes, so what you emit
here decides whether the next incident is a query or an archaeology project.

Every error path needs three things.

## 1. Span status

```go
span.SetStatus(codes.Error, err.Error())          // Go
```

```python
span.set_status(StatusCode.ERROR, str(e))          # Python
```

```javascript
span.setStatus({ code: SpanStatusCode.ERROR, message: err.message }); // Node.js
```

Auto-instrumentation sets this for transport-level failures — an HTTP 500, a refused
connection. It cannot know that your handler caught an exception, logged it, and
returned a polite error response. That one is on you, and it is the most common gap:
`validate-traces.md` assertion A7 exists to catch it.

## 2. The `error` boolean

```go
span.SetAttributes(attribute.Bool("error", true))
```

Redundant with status, and worth it — it is trivially filterable and groupable alongside
every other attribute on the row.

## 3. A **slug**

A static, hand-assigned string identifying _this exact throw site_:

```go
span.SetAttributes(
    attribute.String("exception.slug", "err-stripe-charge-failed"),
    attribute.Bool("error", true),
)
span.RecordError(err)
span.SetStatus(codes.Error, err.Error())
```

The slug is the highest-leverage thing in this file, for three reasons:

- **Greppable** — see `err-stripe-charge-failed` on a chart, search the codebase, land on
  the line that threw. No stack-trace parsing, no guessing.
- **Low-cardinality** — safe to `GROUP BY`. Exception _messages_ are not: they interpolate
  IDs and timeouts, so every occurrence is its own group.
- **Gap-detecting** — any span with `error=true` and no slug is an error path nobody
  instrumented. That inverted query is how you find the failures you never anticipated.

Rules: static string literals only — never interpolate. One per throw site. Prefix
consistently (`err-`) so they're greppable as a class.

## Record the exception too

`RecordError` / `record_exception` attaches `exception.type`, `exception.message`, and
`exception.stacktrace` for human reading. Keep doing it — it complements the slug rather
than replacing it. The slug is what you _aggregate_ on; the exception detail is what you
_read_ once aggregation has pointed you somewhere.

## Errors you expect

Not every error is a defect. Bot traffic hitting dead routes, validation rejections, and
deliberate 404s are normal operation. Mark them:

```go
span.SetAttributes(attribute.Bool("exception.expected", true))
```

Without this, your error rate is dominated by noise and nobody trusts the alert. With it,
`error = true AND exception.expected = false` is the number that should page someone.

## Errors in child spans

Set the status on the span where the failure happened **and** propagate a summary to the
parent. A parent span that looks successful while a child failed is misleading in the
waterfall and invisible in any query that only looks at root spans.

At minimum, put `error=true` and the slug on the entry-point span too. That way the
request is findable without traversing the trace.

## Verify it

You drove deliberate failures in `drive-traffic.md`, so these must return rows:

```bash
# every failure carries ERROR status
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" \
  --status-code ERROR --json | jq 'length'

# and every one of them carries a slug
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" \
  --status-code ERROR --json \
  | jq -r '.[] | [.name, (.attributes["exception.slug"] // "NO-SLUG")] | @tsv'
```

Zero rows from the first command does not mean no errors — you drove them on purpose.
It means the error paths are silent.

Language-by-language patterns:
[references/custom-instrumentation.md](../references/custom-instrumentation.md).
