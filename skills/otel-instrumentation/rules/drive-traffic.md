| title         | impact   | tags                           |
| ------------- | -------- | ------------------------------ |
| Drive Traffic | CRITICAL | validate, traffic, run-id, e2e |

# Drive Traffic

Telemetry only exists if something ran. **You** generate the traffic — asking the user to
click around a dev server is the last rung of the ladder, not the plan. Driving it
yourself makes the validation loop deterministic and repeatable.

## Tag the run first

Before launching the app, stamp every signal it emits with a unique run tag:

```bash
RUN_ID=$(uuidgen)
export OTEL_RESOURCE_ATTRIBUTES="validation.run_id=$RUN_ID"
export OTEL_SERVICE_NAME=my-service
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_BSP_SCHEDULE_DELAY=500   # flush every 500ms so short runs don't lose spans
```

`OTEL_RESOURCE_ATTRIBUTES` is honoured by every OTel SDK and lands on the resource of
every span, log, and metric from that process. It buys you an exact query:

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --json
```

That returns **exactly this run** — no time-window arithmetic, no stale spans from the
previous attempt, no cross-talk from other services on the same backend. Every assertion
in `validate-traces` filters on it.

Keep `$RUN_ID` in the shell for the whole loop. Mint a new one each time you re-drive
after a fix, so a stale pass can never be mistaken for a fresh one.

## The ladder

Work down. Each rung is a fallback for the one above.

### 1. Run the existing test suite (best)

If the repo has integration or end-to-end tests, run them with the OTel env vars set.
Real code paths, real data shapes, zero new code:

```bash
npm test          # or: go test ./... | pytest | bundle exec rspec | dotnet test
```

Unit tests with everything mocked are usually worthless here — they never reach the I/O
that auto-instrumentation hooks. Prefer whatever target boots the real app.

### 2. Sweep the HTTP routes

Enumerate the routes from the framework rather than guessing, then hit each one.

| Stack                       | Where the routes live                                                     |
| --------------------------- | ------------------------------------------------------------------------- |
| Express / Fastify           | `app.get/post(...)` registrations; `app._router.stack` at runtime         |
| Next.js                     | file tree under `app/**/route.ts`, `app/**/page.tsx`, `pages/api/**`      |
| Go net/http, Gin, Echo, Chi | `mux.Handle`, `r.GET(...)`, `e.POST(...)` registrations                   |
| Flask / FastAPI             | `@app.route` / `@app.get` decorators; FastAPI also serves `/openapi.json` |
| Django                      | `urlpatterns` in `urls.py`                                                |
| Rails                       | `bin/rails routes`                                                        |
| Spring                      | `@GetMapping` / `@RequestMapping` annotations                             |

Then drive them:

```bash
BASE=http://localhost:3000
for path in / /api/users /api/users/1 /api/orders; do
  curl -s -o /dev/null -w "%{http_code} $path\n" "$BASE$path"
done
```

Hit each route at least twice — a single sample can't show a latency distribution, and
some caches only reveal themselves on the second call.

### 3. Write a driver script

For anything that isn't an HTTP server — CLI tools, queue consumers, workers, cron jobs,
batch pipelines — write a throwaway script that invokes the entry point once per code
path, and delete it once the loop is green.

```bash
# queue consumer: publish the messages it consumes
node scripts/_drive.mjs        # publishes one valid + one poison message

# CLI: invoke each subcommand
./mytool sync --dry-run
./mytool sync
./mytool export --format json
```

Put the driver in the scratchpad or a `_drive` prefix so it is obviously disposable, and
confirm it is gone before reporting the work complete.

### 4. Ask the user (last resort)

Only when the app genuinely cannot boot headlessly — it needs production credentials, an
SSO login, a real payment gateway, or hardware. Say precisely what to exercise and what
you'll check:

> Start the app with these env vars and hit the checkout flow once, including one card
> decline. I'll assert on `validation.run_id=<id>` when you tell me it's done.

## Drive failures on purpose

Traffic that only returns 200 cannot prove your error instrumentation works. The
"errors carry ERROR status and a slug" assertion passes _vacuously_ when no error ever
happened — which looks identical to success and is the most common way this loop lies
to you.

Force at least one failure per error class the code handles:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/users/99999999"      # not found
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/api/orders" \
     -H 'Content-Type: application/json' -d '{"malformed":'             # bad payload
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/admin"              # unauthorised
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/no-such-route"          # 404
```

If the service depends on something you can stop — a database, a cache, an upstream —
stop it and drive one more request. That is the only way to see the dependency-failure
path instrumented.

## Don't lose the tail

Short-lived processes exit before the batch span processor ships its buffer, which
presents exactly like "no data received".

- Set `OTEL_BSP_SCHEDULE_DELAY=500` (and `OTEL_METRIC_EXPORT_INTERVAL=1000` for metrics)
- Stop servers with **SIGTERM**, never SIGKILL — `kill $PID`, not `kill -9 $PID`
- Give the exporter a moment before asserting: `sleep 2` after the process exits
- Confirm the SDK's shutdown hook actually runs — see `validate-shutdown.md`

## Done when

- Every entry point you discovered has been driven at least once
- At least one deliberate failure has been driven per handled error class
- Any driver script you wrote has been deleted
- `traces search --resource-attr "validation.run_id=$RUN_ID"` returns a non-empty result

Then run `validate-traces.md`.
