| title    | impact | tags                       |
| -------- | ------ | -------------------------- |
| Sampling | MEDIUM | instrument, sampling, cost |

# Sampling

Start with no sampling. Add it when volume or cost forces the question — not before, and
not by default. Sampling is a trade, and the thing you trade away is the ability to
debug the rare event.

Running against a local Kopai backend, you almost never want sampling on: it hides data
during exactly the phase where you're checking your instrumentation is correct. If your
validation loop is missing spans, check the sampler before anything else.

## Do the arithmetic before choosing a rate

An error affecting 0.1% of requests, head-sampled at 1%, is captured once per 100,000
occurrences. At moderate traffic that error effectively does not exist in your data — and
it is precisely the kind you most need a trace for, because it's too rare to reproduce.

Sampling rates are a claim about which failures you're willing to never see. Make it
deliberately.

## Head sampling — cheap, blind

The decision happens when the trace starts, before anything interesting has occurred.

```bash
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1        # keep 10%
```

| Sampler                    | Behaviour                                             |
| -------------------------- | ----------------------------------------------------- |
| `always_on`                | Keep everything. The default, and the right start     |
| `always_off`               | Keep nothing                                          |
| `traceidratio`             | Keep a fixed fraction, decided at root                |
| `parentbased_traceidratio` | Respect the upstream decision; ratio only at the root |

Always use the `parentbased_` variant in a multi-service system. Without it, each service
decides independently and you get traces with holes — a span here, its child dropped
there, and a waterfall that appears to show gaps in the work rather than gaps in the data.

**Reach for it when:** throughput is very high, traffic is homogeneous, and you can accept
losing rare events.

## Tail sampling — faithful, more moving parts

The decision happens after the trace completes, so it can be made on what actually
happened: keep every error, keep everything slow, keep a fraction of the routine traffic.

This needs a component that buffers whole traces — an OTel Collector with the
`tail_sampling` processor. That is infrastructure you now operate, and it must see every
span of a trace, which constrains how you load-balance.

**Reach for it when:** debuggability matters more than simplicity, which is most systems
that page a human.

## Keep what you'd get paged about

Whichever you choose, the rule is the same: sample the boring traffic, keep the
interesting traffic. A 200 on a health check is worth ~0% sampling. A 500 on checkout is
worth 100%, always.

Head sampling cannot express that distinction — it doesn't know the outcome yet. If your
sampling policy needs to depend on what happened, you need tail sampling; there is no
head-sampling configuration that gets you there.

## Consequences to expect

- **Counts become estimates.** Anything that samples must record its rate so consumers
  can weight correctly. A count read without weighting is wrong by the sampling factor.
- **Traces can be incomplete** when services disagree — the `parentbased_` fix above.
- **The rare event goes first.** By construction, sampling removes the uncommon before the
  common. That is the same category as most incidents.

## Verify

After changing any sampler, re-drive and re-assert. With sampling on, `validate-traces.md`
assertions become probabilistic and stop being a reliable gate — so set
`OTEL_TRACES_SAMPLER=always_on` for the validation run, confirm the loop is **green**, and
only then apply the production sampling configuration.
