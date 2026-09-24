---
"@kopai/core": minor
"@kopai/mcp": minor
"@kopai/sdk": minor
"@kopai/api": minor
"@kopai/sqlite-datasource": minor
"@kopai/clickhouse-datasource": minor
---

Reject an unknown key or an inverted time window instead of running a different
query.

Every object in the query language was a `z.object`, which drops a key it does
not recognise. A caller that wrote `filter` for `filters` got back the entire
unfiltered window, with no issue raised and nothing in the response to say a
field had been ignored — the query ran, so the result read as an answer rather
than as a mistake. The MCP `query` tool is driven by a model, which makes a
near-miss key the normal case rather than a rare one, and its advertised schema
made this worse: in `io: "input"` mode zod emits no `additionalProperties` for a
plain `z.object`, so the document stated no rule a host could have enforced
either. (The same failure, one layer up, is the `spanAttributes` bug in the
trace Tags filter — a key zod stripped, and a search that silently ran
unfiltered.)

All of them are now `z.strictObject`, so an unrecognized key is reported. The
generated tool schema says `additionalProperties: false` on every node, and
`runQueryTool` also rejects an argument written beside `query` rather than
inside it — `{query, limit}` used to drop the `limit` and run with the default.

`parseKopaiQuery` names the key in the issue path and, where one is close
enough, the key that was probably meant: `filter` is answered with
`Did you mean "filters"?`, and so are `limitt`, `dimension` and `colunm`. The
budget is one insertion, deletion, substitution or transposition, scaled so a
short key cannot be corrected into an unrelated one, and a tie yields no
suggestion. Where nothing is close, the message lists the keys accepted at that
path. Each unknown key gets its own issue rather than one issue for the object.

`validateKopaiQuery` now also rejects an absolute window whose `startTime` is
not before its `endTime`. Both bounds are valid datetimes, so no schema can
catch it; left through, the query matched nothing and the empty result was
indistinguishable from "there is no telemetry in that window", which sends the
caller to widen a window that was inverted. Equal bounds are rejected too —
`endTime` is exclusive.

Behaviour that changes with this, all of it previously silent:

- A field removed from the query language is reported rather than dropped:
  `kind` on a filter leaf, `compareOffset` on a time dimension.
- The HTTP query routes answer 400 for an unknown field in the body instead of
  stripping it and running the query.
- `KopaiClient`'s query methods throw on an unknown field instead of dropping
  it before the request, and the query builder rejects reversed
  `timeAbsolute` bounds at `build()`.
- A dashboard definition whose `query` datasource carries an extra key in
  `params` now fails validation rather than running a narrower query than it
  describes.
