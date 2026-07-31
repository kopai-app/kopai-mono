| title              | impact | tags                     |
| ------------------ | ------ | ------------------------ |
| Missing Attributes | HIGH   | troubleshoot, attributes |

# Missing Attributes

Spans arrive, but they're too narrow to answer anything. First, see what you actually have:

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --json \
  | jq -r '.[].SpanAttributes // {} | keys[]' | sort -u
```

Diff that against [references/attributes.md](../references/attributes.md).

## Symptom: nothing but auto-instrumented HTTP fields

Expected — no SDK can guess your user model or business domain. This isn't a bug, it's
the work: `instrument-attributes.md`, starting with who was affected, what changed, and
where the time went.

## Symptom: an attribute is set in code but never arrives

**Set on the wrong span.** `SetAttributes` applies to the span you're holding. Inside a
handler you usually want the _current_ span from context, not a new one:

```go
span := trace.SpanFromContext(ctx)          // the active span
span.SetAttributes(attribute.String("user.id", userID))
```

```python
span = trace.get_current_span()
span.set_attribute("user.id", user_id)
```

```javascript
const span = trace.getActiveSpan();
span?.setAttribute("user.id", userId);
```

**Set after `End()`.** Attributes added to an ended span are silently discarded. Set them
before the span closes — in Go, before the `defer span.End()` fires.

**No active span.** `getActiveSpan()` returning a non-recording span means context didn't
reach this code — `context-propagation.md`. In Node.js the `?.` above hides this failure
entirely; check the span is recording if you suspect it.

**Wrong type.** Attribute values must be primitives or arrays of primitives. Passing a
struct, dict, or object is dropped by some SDKs and stringified by others.
Serialise deliberately, or pick out the fields you need as separate attributes.

## Symptom: resource attributes missing

Resource attributes are set once at SDK init, not per span. Set them via the environment
so they can't drift:

```bash
export OTEL_RESOURCE_ATTRIBUTES="service.version=$(git rev-parse --short HEAD),deployment.environment=local"
```

If they're set programmatically, confirm the resource is merged with the default rather
than replacing it — replacing it drops `service.name` and the SDK-detected fields.

## Symptom: `http.route` is a concrete URL

`/api/users/8823` instead of `/api/users/{id}` means the route pattern wasn't captured —
usually middleware registered outside the router, so it never sees the match. Every ID
becomes its own group and aggregation stops working. `context-propagation.md`.

## Symptom: attributes present but useless for grouping

High-cardinality values where you wanted categories — a raw message instead of a category,
a timestamp instead of a bucket. Add a low-cardinality companion rather than replacing the
detail: keep `exception.message` for reading, add `exception.slug` for grouping
(`instrument-errors.md`).

## Verify

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" \
  --span-attr "user.id=<a value you drove>" --json | jq 'length'
```

Non-zero means the attribute is queryable, which is the only thing that counts.

## Reference

https://opentelemetry.io/docs/concepts/semantic-conventions/
