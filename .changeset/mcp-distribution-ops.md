---
"@kopai/mcp": minor
---

The `query` tool advertises the new metric measures (`HISTOGRAM_QUANTILE`,
`HISTOGRAM_AVG`, `SUMMARY_QUANTILE`, `INCREASE`, `RATE`) with descriptions
that tell the model when to use each, and to report only a percentile's value
to people, never its range.
