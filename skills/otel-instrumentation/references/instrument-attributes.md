| title      | impact   | tags                               |
| ---------- | -------- | ---------------------------------- |
| Attributes | CRITICAL | instrument, attributes, wide-event |

# Attributes

A span is a **wide event**: one flat record holding everything known about a unit of
work. Every attribute is a dimension you can group by, filter on, and correlate against
every other dimension on the same row — _without redeploying to add it later_.

The width of your events sets the ceiling on the questions you can ask. Adding
`user.id`, `service.version`, and `cache.hit` to the same span lets you find "slow
requests are tenant X, on the new version, missing cache". Three separate metrics can
never produce that answer, because each pre-aggregated the others away.

Full catalog by category, with rationale and example queries:
[references/attributes.md](../references/attributes.md).

## Start here

Adding attributes to spans that already exist is the highest-value, lowest-risk
instrumentation you can do. It needs no new spans, no restructuring, and no decisions
about trace shape — just more context on the events you're already paying for.

Three questions every investigation opens with. Cover them first:

| Question                   | Attributes                                                                |
| -------------------------- | ------------------------------------------------------------------------- |
| **Who is affected?**       | `user.id`, `user.type`, `user.org.id`, tenant, region                     |
| **What changed?**          | `service.version`, `service.build.git_hash`, `feature_flag.*`, deploy age |
| **Where did the time go?** | timing attributes, `cache.*` hit/miss, `stats.*` rollups                  |

`validate-traces.md` assertion A8 fails if any of the three is missing, because an
incident that hits that gap stalls until someone redeploys.

## Cardinality is not a cost here

On metrics, a high-cardinality dimension is expensive — every value combination becomes
its own time series. On spans it is just another column on a row you were already
storing. `user.id` with ten million values is fine on a span and ruinous on a counter.

So: put high-cardinality context on **spans**, keep metric dimensions low-cardinality.
`validate-metrics.md` assertion M4 catches the mistake in the other direction.

## Timing attributes

Record a sub-operation's duration on the parent span instead of creating a child span
for it. Easier to query, no JOIN, and it groups directly against the request's other
dimensions.

```go
span := trace.SpanFromContext(ctx)
authStart := time.Now()
user, err := authenticate(r)
span.SetAttributes(attribute.Float64("auth.duration_ms",
    float64(time.Since(authStart).Milliseconds())))
```

```python
span = trace.get_current_span()
auth_start = time.monotonic()
user = authenticate(request)
span.set_attribute("auth.duration_ms", (time.monotonic() - auth_start) * 1000)
```

Now "slow requests spent their time in auth" is a single query, and it correlates with
user tier and region on the same row. Full versions for every language in
[references/custom-instrumentation.md](../references/custom-instrumentation.md).

## Async request summaries

Roll child-operation statistics up onto the parent span, so pathological requests are
visible without counting spans by hand:

| Attribute                    | Example    | Reveals                   |
| ---------------------------- | ---------- | ------------------------- |
| `stats.db_query_count`       | `7`, `742` | N+1 queries               |
| `stats.db_query_duration_ms` | `1254`     | Time lost to the database |
| `stats.http_requests_count`  | `1`, `140` | Fan-out to upstreams      |
| `stats.cache_miss_count`     | `0`, `31`  | Cache doing nothing       |

A request issuing 742 database queries is almost certainly a bug. Without a rollup it is
invisible — it just looks like one slow request among many, and the 742 child spans are
only findable if you already suspected them.

## Naming

- Dot-namespaced: `user.id`, `order.total`, `cache.hit`
- Follow OTel semantic conventions for anything standard — `http.route`, `db.system`,
  `rpc.service`, `messaging.destination`. Never invent a variant of a standard name;
  it breaks every tool that understands the convention.
- Namespace your own additions: `app.`, `checkout.`, `<company>.`
- Types are stable: if `order.total` is a float, it is always a float. A field that is
  sometimes a string and sometimes a number is painful to query and worse to alert on.
- Booleans, not strings, for flags: `cache.hit=true`, not `cache.hit="yes"`

## Don't put these on spans

- Secrets, credentials, tokens, API keys
- Full request or response bodies — sample or extract the fields that matter
- Personal data your compliance regime doesn't allow in telemetry. `user.id` is usually
  fine; email addresses, names, and payment details usually aren't. Check before adding.
