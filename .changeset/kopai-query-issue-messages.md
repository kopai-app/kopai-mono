---
"@kopai/core": minor
---

Make query validation issues name the field that is actually wrong.

`KopaiQuery`'s branches contain further unions — a measure expression, a column
reference, a filter node — and when one of those fails, zod reports the failure
at the union itself with the bare message `Invalid input`. That was the least
useful message on the three fields a caller is most likely to get wrong.

`parseKopaiQuery` now answers the question zod declines to: it re-parses the
value against each member, works out which one the caller was reaching for, and
reports that member's own issues. So `measures.0: Invalid input` becomes
`measures.0.column: Unknown value "NoSuchColumn"`, and the self-referential
filter schema is descended into rather than stopping at `filters.0`.

Near misses are suggested, folding case and punctuation: `"ServiceName"` is
answered with `Did you mean "service.name"?`, and `"count"` with
`Did you mean "COUNT"?`. Where no member fits, the message lists what the union
accepts across all of its variants — so a bad measure operator names `COUNT`
alongside the numeric operators, rather than only the variant zod happened to
compare against last. Long enums are sampled rather than printed in full; the
complete list is already in the schema callers hold.

This rewrites message text and issue paths only. Nothing changes about what is
accepted or rejected, and `@kopai/sdk`'s query builder — the other caller —
needed no edit.
