---
"@kopai/ui": minor
"@kopai/ui-core": patch
---

Internal restructure — `@kopai/ui` now re-exports DOM-free symbols from `@kopai/ui-core` instead of shipping its own copies. Public API unchanged (additive only — new symbols exposed, no removals). New code should prefer importing non-DOM symbols from `@kopai/ui-core` directly. `@kopai/ui-core` patch: add `CatalogueComponentProps` to the public barrel so `@kopai/ui`'s dashboard primitives can use it.
