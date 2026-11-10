| title         | impact | tags                        |
| ------------- | ------ | --------------------------- |
| Missing Spans | HIGH   | troubleshoot, spans, orphan |

# Missing Spans

Some telemetry arrives, but not the spans you expected. Diagnose by symptom.

If _nothing_ arrives, start at `troubleshoot-no-data.md` instead.

## Symptom: every span is a root — the trace is flat

Context isn't propagating. This is the most common failure in the whole skill, and the
code runs perfectly the entire time it's happening.

```bash
npx @kopai/cli traces search --resource-attr "validation.run_id=$RUN_ID" --json \
  | jq -r '.[] | select((.ParentSpanId // "") == "") | .SpanName' | sort | uniq -c | sort -rn
```

Every name here that isn't an entry point is a break. Go to `context-propagation.md` —
specifically the framework accessor table, since using the wrong context object compiles
cleanly and silently detaches everything downstream.

## Symptom: the handler span exists, its children don't

Auto-instrumentation for that library isn't installed or isn't hooked.

```bash
npm ls @opentelemetry/auto-instrumentations-node       # Node.js
pip list | grep opentelemetry-instrumentation          # Python
go list -m all | grep otelsql                          # Go — per-library wrappers
```

Go is the usual culprit: it has no blanket auto-instrumentation, so each library needs
its own wrapper (`otelhttp`, `otelsql`, `otelgorm`) applied explicitly. Nothing warns you
when one is missing.

Also confirm the instrumented client is the one the code actually calls. Wrapping a
`*sql.DB` you then never use is easy to do and invisible.

## Symptom: a route produces no span at all

Middleware ordering. OTel middleware registered after the router — or on a sub-router
that some paths bypass — never wraps those handlers.

Register it first and outermost. Then re-drive that specific route and re-check
assertion A5.

## Symptom: spans appear, but named `unknown_service` or generic

The resource isn't configured. `echo $OTEL_SERVICE_NAME` in the shell that launched the
app; if it's set there but not in the telemetry, the SDK is being configured
programmatically with a resource that overrides the environment.

## Symptom: business logic spans missing

Nothing auto-instruments your own functions — that's the point of `instrument-spans.md`.
Decide which operations are **interesting** and **aggregable**, then add spans there.

## Symptom: spans vanish under load but not in dev

Sampling, or a queue overflow. Check `OTEL_TRACES_SAMPLER` (`sampling.md`), then raise
`OTEL_BSP_MAX_QUEUE_SIZE` — the batch processor drops spans silently when its queue is
full, which looks exactly like sampling.

## Symptom: SDK loaded, still nothing from instrumented libraries

Initialisation ordering. The SDK must start _before_ the libraries it patches are
imported. In Node.js this means `--import`/`--require`, not a `require()` at the top of
`server.mjs` — by then the modules are already loaded and unpatchable.

Two more causes with the identical symptom — patching that no-ops without an error:

- **ES-module imports.** Patching happens in Node's `require` hook. In a
  `"type": "module"` app only CommonJS dependencies still pass through it; the app's own
  `import http from "node:http"` and any dependency published as native ESM bypass it,
  so the SDK starts, runtime metrics flow, and no span is ever created. Register OTel's
  loader hook before the app loads — `register("@opentelemetry/instrumentation/hook.mjs",
import.meta.url)` from `node:module` at the top of `instrumentation.mjs`
  (`lang-nodejs.md`), or `--experimental-loader=@opentelemetry/instrumentation/hook.mjs`.
  If the framework ships a native plugin, prefer it over loader mechanics entirely
  (Fastify → `lang-fastify.md`).
- **A deprecated instrumentation package.** Deprecation doesn't disable the code — it
  means unmaintained and superseded, so it silently falls behind the framework versions
  and loader semantics it once patched. Check the version actually installed —
  `npm ls <pkg>` (`pnpm list <pkg>` / `yarn why <pkg>`) — then
  `npm view <pkg>@<version> deprecated`; a bare `npm view <pkg> deprecated` reads the
  latest release, which may differ. `npm view` works in any project regardless of its
  package manager — it is a registry read, and npm ships with Node. The message
  is free text: it usually names the replacement; when it doesn't, check the package's
  migration notes. Either way, spend the time migrating (after a compatibility check),
  not debugging the abandoned package. Known case:
  `@opentelemetry/instrumentation-fastify` → `@fastify/otel`.

## Then

Re-drive (`drive-traffic.md`) with a fresh `$RUN_ID` and re-run **all** of
`validate-traces.md`. Fixing propagation frequently reveals a second break behind the first.
