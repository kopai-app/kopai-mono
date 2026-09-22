---
"@kopai/core": minor
"@kopai/sdk": patch
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
`SCHEMA_MAP`. `kq`, `KopaiQueryBuildError` and every issue path are unchanged;
this is an internal refactor with no behaviour change, and the builder's tests
pass untouched.
