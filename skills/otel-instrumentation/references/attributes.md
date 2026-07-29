# Attribute Catalog

The canonical list of attributes worth putting on spans, by category. Other rules point
here rather than keeping their own lists.

Every attribute is a dimension you can group by, filter on, and correlate against every
other attribute on the same row. The wider your events, the more questions you can answer
**without redeploying** — which is the entire point, since the question you need at 3am
is the one you didn't anticipate.

Verify anything here with:

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" \
  --span-attr "<key>=<value>" --json | jq 'length'
```

---

## Start with these

If you do nothing else, cover the three questions every investigation opens with.
`validate-traces.md` assertion A8 checks for them.

| Question               | Minimum                                    |
| ---------------------- | ------------------------------------------ |
| Who is affected?       | `user.id`, `user.type`                     |
| What changed?          | `service.version`                          |
| Where did the time go? | timing attributes on slow paths, `cache.*` |

---

## User and business context

The most valuable attributes you can add, and the ones no SDK can infer.

| Attribute          | Examples                        | Description                                        |
| ------------------ | ------------------------------- | -------------------------------------------------- |
| `user.id`          | `2147483647`                    | Primary user identifier                            |
| `user.type`        | `free`, `premium`, `enterprise` | Tier or segment                                    |
| `user.auth_method` | `token`, `jwt`, `sso-github`    | How they authenticated                             |
| `user.team.id`     | `5387`                          | Team or group                                      |
| `user.org.id`      | `278`                           | Organisation, for enterprise accounts              |
| `user.age_days`    | `0`, `637`                      | Account age — separates new users from established |

**Why:** one enterprise account can be 10% of revenue. Without these you can't tell a
weird edge case from a revenue-critical path breaking for your largest customer. With
them, "all the slow requests are one tenant" is one query.

**Careful:** `user.id` is usually fine; names, emails, and payment details usually aren't.
Check your compliance regime before putting personal data in telemetry.

---

## Service metadata

| Attribute               | Examples                         | Description                                       |
| ----------------------- | -------------------------------- | ------------------------------------------------- |
| `service.name`          | `api`, `checkout`                | This service                                      |
| `service.environment`   | `production`, `staging`, `local` | Where it's running                                |
| `service.team`          | `web-services`                   | Owning team — the on-call rotation to escalate to |
| `service.slack_channel` | `#web-services`                  | Where to reach them                               |

**Why:** during an incident the first question is often "who owns this?" These let you
answer it from telemetry instead of a service catalogue nobody has updated.

---

## Build and deploy

| Attribute                              | Examples          | Description                          |
| -------------------------------------- | ----------------- | ------------------------------------ |
| `service.version`                      | `v123`, `9731945` | Version string or image hash         |
| `service.build.git_hash`               | `6f6466b0e693`    | Git SHA of the deployed commit       |
| `service.build.deployment.age_minutes` | `1`, `10230`      | How long since this version deployed |
| `service.build.deployment.trigger`     | `merge-to-main`   | What triggered the deploy            |
| `service.build.deployment.user`        | `sam@company.com` | Who shipped it                       |

**Why:** "did something just get deployed?" is the most frequently asked question in
incident response, and the answer is usually yes. `service.version` lets you compare
error rates between versions directly, which turns a hunch into evidence in one query.

Set these from the environment so they can't drift:

```bash
export OTEL_RESOURCE_ATTRIBUTES="service.version=$(git rev-parse --short HEAD)"
```

---

## Feature flags

| Attribute             | Examples        | Description                         |
| --------------------- | --------------- | ----------------------------------- |
| `feature_flag.<name>` | `true`, `false` | Value of that flag for this request |

One attribute per flag — `feature_flag.new_checkout`, `feature_flag.auth_v2`.

**Why:** flags are how you test in production, but only if you can compare the two sides.
Without them a partial rollout produces an error rate that moves for no visible reason.

---

## Error details

| Attribute              | Examples                   | Description                                            |
| ---------------------- | -------------------------- | ------------------------------------------------------ |
| `error`                | `true`, `false`            | Did this fail                                          |
| `exception.slug`       | `err-stripe-charge-failed` | Static, greppable identifier for the throw site        |
| `exception.type`       | `IOError`                  | Programmatic exception type                            |
| `exception.message`    | `connection reset`         | Message, for reading not grouping                      |
| `exception.stacktrace` | …                          | Stack trace where available                            |
| `exception.expected`   | `true`, `false`            | Normal operation (bot traffic, validation) vs a defect |

**Why the slug:** it's low-cardinality so you can group by it, greppable so a chart leads
straight to the line of code, and it detects its own gaps — any `error = true` with no
slug is an error path nobody instrumented. See `references/instrument-errors.md`.

---

## Timing breakdowns

| Attribute                   | Examples      | Description                       |
| --------------------------- | ------------- | --------------------------------- |
| `auth.duration_ms`          | `52.2`, `0.2` | Time in authentication            |
| `payload_parse.duration_ms` | `22.1`        | Time parsing the request          |
| `<operation>.duration_ms`   |               | Any sub-operation worth measuring |

**Why:** a child span needs a JOIN to correlate with its parent's context. A duration on
the parent sits in the same row as user tier, version, and route — so "slow requests spent
their time in auth, for enterprise users, on the new version" is a single query.

Implementation: [custom-instrumentation.md](custom-instrumentation.md).

---

## Async request summaries

| Attribute                         | Examples   | Description                          |
| --------------------------------- | ---------- | ------------------------------------ |
| `stats.db_query_count`            | `7`, `742` | Database queries this request issued |
| `stats.db_query_duration_ms`      | `1254`     | Cumulative time in the database      |
| `stats.http_requests_count`       | `1`, `140` | Upstream calls made                  |
| `stats.http_requests_duration_ms` | `849`      | Cumulative time in those calls       |
| `stats.cache_miss_count`          | `0`, `31`  | Cache misses                         |

**Why:** a request making 742 database queries is a bug. Without a rollup it's invisible —
it looks like one slow request, and the 742 child spans are only findable if you already
suspected them.

---

## Caching

| Attribute      | Examples        | Description                  |
| -------------- | --------------- | ---------------------------- |
| `cache.<name>` | `true`, `false` | Did this operation hit cache |

One boolean per cacheable operation — `cache.session`, `cache.feature_flags`,
`cache.product_catalog`.

**Why:** cache misses are among the most common causes of latency spikes, and a boolean
per path makes "the slow ones all missed cache" fall out immediately.

---

## HTTP, beyond auto-instrumentation

| Attribute                 | Examples                         | Description                    |
| ------------------------- | -------------------------------- | ------------------------------ |
| `http.route`              | `/team/{team_id}/user/{user_id}` | The route **pattern** matched  |
| `http.route.param.<name>` | `14739`                          | Extracted route parameter      |
| `http.route.query.<name>` | `asc`                            | Query parameters that matter   |
| `user_agent.device`       | `computer`, `phone`              | Device parsed from User-Agent  |
| `user_agent.browser`      | `Chrome`                         | Browser parsed from User-Agent |

**Why:** without `http.route` a latency spike says "some requests are slow". With it,
"only `POST /checkout` is slow". Parsed user-agent fields find client-specific bugs
without regex over raw strings.

`http.route` must be the pattern, never the concrete URL — see `validate-traces.md` A6.

---

## Infrastructure and orchestration

| Attribute                                  | Examples        | Description                  |
| ------------------------------------------ | --------------- | ---------------------------- |
| `instance.id`                              | `656993bd-40e1` | This instance of the service |
| `instance.type`                            | `m6i.xlarge`    | Instance type                |
| `instance.memory_mb`                       | `12336`         | RAM available                |
| `instance.cpu_count`                       | `4`, `8`        | Cores available              |
| `container.id` / `container.name`          | `a3bf90e006b2`  | Container identity           |
| `k8s.cluster.name` / `k8s.pod.name`        | `api-cluster`   | Kubernetes topology          |
| `cloud.region` / `cloud.availability_zone` | `us-east-1c`    | Where it runs                |

**Why:** infrastructure problems present per-AZ or per-node. These are what let "all the
slow requests are in `us-east-1c`" surface on its own instead of being guessed at.

---

## Runtime versions

| Attribute                                        | Examples   | Description      |
| ------------------------------------------------ | ---------- | ---------------- |
| `go.version` / `python.version` / `node.version` | `go1.23.2` | Language runtime |
| `<framework>.version`                            | `7.2.1.1`  | Web framework    |
| `<datastore>.version`                            | `16.4`     | Datastore        |

**Why:** "we upgraded the runtime recently — is that the memory increase?" is unanswerable
without them.

---

## Rate limits

| Attribute             | Examples | Description          |
| --------------------- | -------- | -------------------- |
| `ratelimit.limit`     | `200000` | Limit being enforced |
| `ratelimit.remaining` | `130000` | Budget left          |
| `ratelimit.used`      | `70000`  | Consumed this window |

**Why:** "why am I being rate limited?" is a common support ticket, and answering it
otherwise means digging through a separate system.

---

## Operational state

| Attribute                  | Examples       | Description                            |
| -------------------------- | -------------- | -------------------------------------- |
| `uptime_sec`               | `1533`         | Seconds since start — exposes restarts |
| `metrics.memory_mb`        | `153`, `2593`  | Memory at request time                 |
| `metrics.cpu_load`         | `0.57`, `5.89` | CPU load at request time               |
| `metrics.gc_count`         | `5390`         | GC count                               |
| `metrics.gc_pause_time_ms` | `14`, `325`    | Time in GC                             |

**Why:** "are the slow requests correlated with GC pauses?" becomes one query instead of
two tools and a timestamp comparison.

---

## Localization

| Attribute                   | Examples       | Description                      |
| --------------------------- | -------------- | -------------------------------- |
| `localization.language_dir` | `rtl`, `ltr`   | Text direction                   |
| `localization.country`      | `mexico`, `uk` | Country the user associates with |
| `localization.currency`     | `USD`, `CAD`   | Preferred currency               |

**Why:** bugs that only reproduce under RTL text or a specific currency are notoriously
hard to find, and trivially filterable once these exist.

---

## Never put on a span

- Secrets, tokens, credentials, API keys
- Full request or response bodies — extract the fields that matter
- Personal data your compliance regime prohibits in telemetry
- Anything you'd be unhappy to see in a screenshot pasted into a chat channel
