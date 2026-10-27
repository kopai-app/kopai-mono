---
"@kopai/sdk": minor
---

The metric measure builder gains `histogramQuantile(q, alias)`,
`histogramAvg(alias)` and `rate`/`increase("Count" | "Sum", alias)` on
`kq.metrics("Histogram")`, `summaryQuantile(q, alias)` on
`kq.metrics("Summary")`, and `rate`/`increase("Value", alias)` on
`kq.metrics("Sum")`. Each appears only on the type it applies to.

Result rows type these measures as `number | null`, and `histogramQuantile`
adds `<alias>_low`, `<alias>_high` (`number | null`), `<alias>_coarsened`
(`0 | 1`) and `<alias>_error` (`string | null`). The builder does not add the
`IsMonotonic` filter a Sum counter needs; `.build()` reports it missing.
