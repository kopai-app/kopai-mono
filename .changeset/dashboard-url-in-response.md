---
"@kopai/cli": minor
---

`dashboards create` response now includes a `url` field — the fully-resolved dashboard URL based on the active `.kopairc` (or `--url` flag, or default). Callers (notably the `create-dashboard` skill) should display this URL directly instead of constructing it from `id`.
