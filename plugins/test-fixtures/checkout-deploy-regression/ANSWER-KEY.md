# Answer key: checkout-deploy-regression

Don't show this file, `generate.mjs` or this folder's README to the session
under test. The generator's comments describe the cause.

## What happened

About 25 minutes before the generator ran, checkout was deployed as
version **1.5.0** (from 1.4.2). The new version gives its payments client
a **200 ms timeout** (it was 2 s). Payments itself is unchanged: most
calls take 60–180 ms, with a slow tail up to ~420 ms. Every payment call
in that tail now times out on checkout's side, so roughly **1 in 7
checkouts fails** (about 12–18%) with a 500, and the frontend returns 502 for those
orders.

## What a correct diagnosis contains

| Element        | Expected                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification | error spike, leading into deploy regression (dependency failure is a reasonable first stop)                                                                            |
| Onset          | at the switch from `service.version` 1.4.2 to 1.5.0 on checkout, minutes before the alert time, pinned from a 1-minute or 5-minute time series, not from the alert     |
| Root cause     | checkout 1.5.0's payments client times out at 200 ms; failing client spans to `payments.internal` carry "context deadline exceeded (client timeout 200ms)"             |
| Key ruling-out | payments is healthy: its own server spans show 0% errors and unchanged latency; the failures happen only on checkout's side, and only on 1.5.0                         |
| Blast radius   | ~12–18% of checkouts since onset (checkout server spans), surfacing as frontend 502s on `/api/checkout`; other routes and services unaffected                          |
| Proposed fix   | roll back checkout to 1.4.2, or ship 1.5.x with the old payments timeout; a human does it                                                                              |
| Routing        | @checkout-team, per the fixture's routing tree; not @payments-team                                                                                                     |
| Confidence     | medium-high or high: the version split and the span status messages are decisive, though without a code host the timeout change is inferred rather than seen in a diff |

## Traps

- **Blaming payments.** The errors are all on calls to payments, but
  payments' own spans are healthy. A diagnosis that routes to
  @payments-team or calls payments "down" is ❌ wrong.
- **Search.** Search is slow (avg ~570 ms) the whole time, before and
  after. Naming it as related is ❌; mentioning it only as ruled out, with
  the baseline, is fine.
- **Latency got better.** Checkout's average latency drops after the
  deploy, because failing calls stop at 200 ms. Reading that as an
  improvement is a ⚠️ partial at best.
- **Percentiles.** On a local SQLite Kopai, `P95` is refused. The session
  should fall back to AVG/MAX and say so, not report "p95".
- **Baseline errors.** checkout had ~0.5% errors before the deploy
  (500s caused by inventory reservation conflicts, which inventory
  answers with HTTP 409). Those are not the incident.

## Grading

Use the scale in the kopai-oncall-setup skill's `references/replay.md`:
✅ correct / ⚠️ partially correct / ❌ wrong / 🚫 harmful. A diagnosis
that proposes changing payments or paging @payments-team is 🚫.
