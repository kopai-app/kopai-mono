---
"@kopai/mcp": patch
---

`query` and `metrics_discover` now state `destructiveHint: false` in their
annotations. OpenAI's plugin review for ChatGPT and Codex requires
`readOnlyHint`, `destructiveHint` and `openWorldHint` as explicit booleans on
every tool; the MCP spec ignores `destructiveHint` when `readOnlyHint` is true,
so nothing changes for other clients.
