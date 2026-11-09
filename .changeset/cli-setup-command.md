---
"@kopai/cli": minor
---

Added `kopai setup`, which connects a project to a Kopai workspace with one command. It exchanges a one-time setup code from the dashboard for tokens and writes them to `./.kopairc`: the CLI's `url` and `token`, plus a new `otlp` block for the app's exporter. It adds `.kopairc` to `.gitignore`, installs the `otel-instrumentation`, `root-cause-analysis`, and `create-dashboard` skills, and registers the Kopai MCP connector in Claude Code, Codex, and Cursor. `--dry-run` prints the plan without exchanging the code or writing anything.

`kopai login` now also warns about a missing `.gitignore` entry in a subdirectory of a git repository, and no longer warns when a parent `.gitignore` already lists `.kopairc`.
