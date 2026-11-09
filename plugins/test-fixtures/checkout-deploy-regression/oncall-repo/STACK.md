# STACK.md — capability → connection map (fixture)

Generated: fixture · Channel: #shop-oncall (dry run: no Slack) · Probed by: hand

| Capability       | Bound to                                    | Probe result                                 | Notes                                                                                                                            |
| ---------------- | ------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `traces`         | Kopai, local (`http://localhost:8000/mcp`)  | ✅ trace summary by service.name: 5 services | services: frontend, checkout, payments, inventory, search · percentiles: unavailable (SQLite) → latency uses AVG/MAX of Duration |
| `metrics`        | Kopai, local                                | ✅ no metrics sent by this fixture           | —                                                                                                                                |
| `logs`           | Kopai, local                                | ✅ error-log summary by service.name         | checkout logs to Kopai                                                                                                           |
| `pager`          | none                                        | —                                            | —                                                                                                                                |
| `code`           | none                                        | —                                            | —                                                                                                                                |
| `alert-channels` | none (dry run: the alert is pasted)         | —                                            | —                                                                                                                                |
| `incidents`      | threads in #shop-oncall beginning "🔴 INC:" | not tested (dry run)                         | —                                                                                                                                |
| `deploys`        | via `service.version` in Kopai              | ✅ versions visible per service              | no deploy feed                                                                                                                   |

## Gaps

- No `pager`: page-severity findings fall back to @-mentioning the routed
  owner in the channel.
- No `code`: deploy contents can't be diffed; deploy timing comes only from
  `service.version` changes in Kopai.
- Dry run: there is no Slack channel; post the diagnosis in the session.

## Access posture

All bindings are read-only.
