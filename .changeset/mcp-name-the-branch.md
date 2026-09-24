---
"@kopai/mcp": patch
---

Name the branch a failed query was judged against.

An `invalid_input` result said only "The query is not valid.", and its issues
name fields. The six query shapes share field names — `measures` is on three of
them, `filters` on all six — so `query.measures.0.column` does not tell a caller
which shape its query was read as, and the `signal`/`mode` pair that decides
that is the one thing it can get wrong without any issue pointing at it. The
message now reads "The traces/aggregate query is not valid." Where the pair
itself is wrong there is no branch to name, the message stays as it was, and the
issues on `signal` and `mode` are what the caller needs instead.

This restores something KOP-95 asked for and the JSON text block dropped: a
failed call naming the branch as well as the field. KOP-106's acceptance gate
reads it back.
