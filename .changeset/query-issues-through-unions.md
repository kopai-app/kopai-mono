---
"@kopai/core": patch
"@kopai/mcp": patch
---

Explain the five discriminators, report the sibling mistake, and degrade the
metrics listing instead of refusing it.

**Issue paths walk into unions.** zod reports a discriminator mismatch at the
discriminator, not at the union — `filters.0.op`, not `filters.0` — and the
path walk stopped at the first union it met, so every such issue kept zod's own
`Invalid discriminator value` text. That covered `op`, `orderBy.type`,
`timeDimension.type`, `output.type` and any enum inside a member
(`direction`): the fields a caller is most likely to get wrong were the ones
the explainer could not reach. A union has no shape of its own, so the schema
at a key is now whatever its members declare there — collapsed into one enum
over every value they accept where those are literals or enums. So
`op: "EQ"` is answered with `Did you mean "eq"?`, `output: {type:
"TimeSeries"}` with `Did you mean "timeSeries"?`, and a two-mistake filter
leaf, which used to report two bare `Invalid input`s at the right paths, now
names the column it did not recognise and the type it expected.

**A suggestion carries its variant's other issues.** `{op: "avg", as: "c"}` is
two mistakes — a lower-cased operator, and `column`, which a numeric measure
requires — and only the first was reported, so fixing it bought a second round
trip to discover the second. The suggestion identifies the variant the caller
meant, so that variant's remaining issues are reported alongside it. Not
without a suggestion: which variant was meant is then unknown, and one member's
requirements are not another's — a COUNT measure needs no `column`, and
inventing that requirement would send the caller to add a field they do not
need.

**A misspelled key no longer reports the key it should have been as missing.**
`valu` for `value` produced both an unrecognized-key issue and a missing-`value`
issue. One mistake, and the half worth reporting is the key that was actually
written. Suppressed only where the suggested key really is absent, so a genuine
problem with a key the caller did send always survives.

**`metrics_discover` degrades rather than dead-ends.** The tool takes no
arguments, so a caller handed `result_too_large` had nothing to change — and
the remedies it was given named a `limit`, a time window and a `granularity`,
none of which it accepts. An over-size listing now drops the values seen on
each attribute (keys kept, under `attributeKeys`), then the attributes, and the
response names what was omitted under `omitted` so a thinner answer cannot pass
as the whole one. Only a listing whose metric names alone overrun is refused,
and its remedies name what is still possible: query a metric by name, or reduce
what the deployment ingests.

**One-bucket time series are classified as time series.** `overflowRemedies`
read `output.type` off the bucket count, so a window spanning a single bucket —
a 30-second window at `5m` — took the summary branch: the `output: {type:
"summary"}` remedy was dropped, and the query was described as having no
granularity when it has one. It now reads the query's own `output.type`, and
the bucket count only orders the advice. A single bucket also drops the coarser-
granularity line, which had nothing to merge, and an ungrouped time series is
offered the summary it was previously denied.
