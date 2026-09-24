---
"@kopai/core": patch
---

Suggest a key the chosen filter member actually accepts.

The candidate list for an unknown key was every union member's keys merged,
which answers "what may appear at this node" but not "what is accepted given
what the caller already wrote". So a key a sibling member declares was offered
as a correction for itself: `{column, op: "in", value: [...]}` was answered with
`Unknown key "value". Did you mean "value"?`, and the same on `eq` or `gt` with
`values`.

The candidates are now the members the value could still be — a member is out
when a literal or enum key it declares rejects what the value carries there,
and out when it shares no key with the value at all, which is the `and`/`or`
wrapper beside a leaf. An `in` filter carrying `value` is now answered with
`Did you mean "values"?`, and `eq` or `gt` carrying `values` with
`Did you mean "value"?`. An operator that takes neither — `isNull`,
`isNotNull` — is answered with the keys it does accept rather than a key that
would also be refused. A key is never offered back as a correction for itself.

Raised in review on PR #180.
