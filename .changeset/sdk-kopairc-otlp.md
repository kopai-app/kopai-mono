---
"@kopai/sdk": patch
---

Added the optional `otlp` block (`endpoint`, `token`) to `KopaiConfig`, the type of `.kopairc`. `kopai setup` writes it, and the query client ignores it.
