---
"@kopai/ui": minor
"@kopai/ui-core": minor
---

Internal restructure — `@kopai/ui` now re-exports DOM-free symbols from `@kopai/ui-core` instead of shipping its own copies. Public API unchanged (additive only — new symbols exposed, no removals). New code should prefer importing non-DOM symbols from `@kopai/ui-core` directly. `@kopai/ui-core` patch: add `CatalogueComponentProps` to the public barrel so `@kopai/ui`'s dashboard primitives can use it.

Also additive: the dashboard `DataSource` union gains a `query` variant (KopaiQuery), wired through `useKopaiData` and the renderer, and the observability catalog's `acceptsDataFrom` lists now include `"query"` for the log/trace/metric renderers — letting dashboard components source data from the new KopaiQuery API.
