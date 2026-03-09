---
"@kopai/sdk": minor
"@kopai/cli": minor
"@kopai/ui": patch
---

Move `/signals` prefix from baseUrl into SDK paths. baseUrl is now the server root (e.g. `http://localhost:8000`). CLI `--url` flag and config now point to server root. Dashboard schema fetch includes auth header.
