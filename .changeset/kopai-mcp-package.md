---
"@kopai/mcp": minor
---

New package: the MCP server plugin's schema layer.

`@kopai/mcp` will expose Kopai's read-only query API to MCP hosts. This first
release carries the package scaffold and the generated tool input schemas; the
tools themselves and the Fastify wiring follow.

`QUERY_TOOL_INPUT_SCHEMA` is the KopaiQuery union wrapped in a single `query`
property — an MCP tool input schema must have an object root — converted to
JSON Schema 2020-12 and deduplicated into `$defs`. The union repeats the same
column enums and filter expressions across all six branches, so emitted
verbatim it is 131,775 characters; deduplicated it is 27,433, a 79.2%
reduction. That matters because a host carries the document in its `tools:`
array on every turn, not once per connection.

The reduction is lossless, which is the property the whole thing rests on: the
deduplicated document accepts and rejects exactly what the raw one does,
asserted over hand-written cases covering all six branches and 4,000 mutated
inputs.

`dedupe` is exported because the deduplication is keyword-aware rather than a
blind object walk — in JSON Schema a nested object is not always a schema, and
hoisting a value out of an `enum` or `const` would change what the document
accepts.

Both schemas are built at module scope. Generating and deduplicating costs
several milliseconds, and the MCP transport builds a fresh server per request,
so doing this work per request would dominate the request itself.

`@kopai/core` is a `peerDependency`, so that a host application resolves one
copy of it rather than this package carrying its own.
