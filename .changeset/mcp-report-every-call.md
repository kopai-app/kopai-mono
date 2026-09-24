---
"@kopai/core": patch
"@kopai/mcp": patch
---

Write down an upstream failure, report every tool call, and stop spending the
explanation budget on nesting.

**An upstream failure is logged.** `"The query could not be completed."` is the
whole of what a model can act on, and it was also the whole of what anyone got:
a datasource refusing connections left nothing for whoever runs the server, in
a product whose purpose is making failures visible. `mcpRoutes` now hands the
tools the Fastify request logger — so the cause lands beside everything else
written about that request — and `logger` on the route options redirects it.
A validation error is still not logged: it is the caller's own mistake, it is
reported back in full, and logging every malformed query would bury the
outages.

**Every tool call reports, including one that throws.** Nothing in the tools is
expected to throw, which is the reason to handle it rather than assume it: a
throw skipped `observe` altogether, so a host's counter lost exactly the calls
most worth seeing, and reached the SDK as a bare message with no
`structuredContent` — the one error shape a live page cannot read. The
registration layer converts an unexpected failure into the same contract as an
expected one: a structured payload, a logged cause, and one observer event.

**A deeply nested filter is still explained.** Each `and`/`or` level spent one
unit of the recursion budget before any of it reached the leaf, so a filter
four wrappers deep fell back to the bare `Invalid input` this module exists to
remove. A level costs one member re-parse of a value that shrinks as it
descends, so the budget can afford to be generous; it now covers about ten
levels of nesting.
