---
"@kopai/core": minor
"@kopai/sdk": minor
---

Share the KopaiQuery branch dispatch and validation between the query builder
and future callers.

`@kopai/core` gains two exports. `kopaiQuery.branchSchemaFor(signal, mode)`
returns the one branch of the `KopaiQuery` union that a signal/mode pair
selects, alongside `SIGNALS`, `MODES`, `isSignal` and `isQueryMode` for
reporting the accepted values back. `kopaiQueryCompiler.parseKopaiQuery(input)`
takes unknown input, selects that branch, parses it and runs the cross-field
checks `validateKopaiQuery` holds, returning `{ ok: true, data }` or
`{ ok: false, issues }` where each issue is a `{ path, message }` pair.

Why the pair matters: parsing an input against the whole six-branch union makes
zod report every branch's failures at once, so one wrong field arrives buried in
five irrelevant schemas' worth of noise. Selecting the branch first means the
issues name the field the caller actually got wrong.

`parseKopaiQuery` returns issues rather than throwing because its callers want
different error types from the same checks — the query builder wraps them in a
`KopaiQueryBuildError`, and other surfaces map them into their own error shape.

`@kopai/sdk`'s query builder now delegates to it and drops its private
`SCHEMA_MAP`. `kq` and `KopaiQueryBuildError` are unchanged and the builder's
tests pass untouched, but the issues that error carries are not. The builder
used to map zod's raw output straight through; it now receives what
`explainIssues` rewrote, so both paths and messages move — `filters.0` becomes
`filters.0.column`, and `dimensions.0`'s bare `Invalid input` becomes
`Unknown value "ServiceName". Did you mean "service.name"?`. Nothing changes
about what is accepted or rejected, but a caller matching on `issue.path` or
`issue.message` sees different values, which is why `@kopai/sdk` takes a minor
bump rather than a patch.
