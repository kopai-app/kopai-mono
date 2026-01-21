# Kopai

Monorepo for Kopai packages.

## Packages

| Package                                            | Description               |
| -------------------------------------------------- | ------------------------- |
| [@kopai/tsconfig](./packages/tsconfig)             | Shared TypeScript config  |
| [@kopai/core](./packages/core)                     | Core logic and types      |
| [@kopai/sdk](./packages/sdk)                       | SDK                       |
| [@kopai/cli](./packages/cli)                       | CLI tool                  |
| [@kopai/api](./packages/api)                       | API (Fastify plugin)      |
| [@kopai/ui](./packages/ui)                         | React components          |
| [@kopai/collector](./packages/collector)           | OTLP collector (Fastify)  |
| [@kopai/sqlite-datasource](./packages/sqlite-datasource) | SQLite datasource   |
| [@kopai/app](./apps/app)                           | Main application          |

### Dependency Graph

```
                              ┌─────────────┐
                              │  tsconfig   │
                              └──────▲──────┘
                                     │
                              ┌──────┴──────┐
        ┌────────────┬────────┤    core     ├────────┬────────────┐
        │            │        └──────▲──────┘        │            │
        │            │               │               │            │
  ┌─────┴─────┐ ┌────┴────┐   ┌──────┴──────┐  ┌─────┴─────┐ ┌────┴─────┐
  │    api    │ │   ui    │   │     sdk     │  │ collector │ │ sqlite-  │
  └─────▲─────┘ └─────────┘   └──────▲──────┘  └─────▲─────┘ │datasource│
        │                            │               │       └────▲─────┘
        │                      ┌─────┴─────┐         │            │
        │                      │    cli    │         │            │
        │                      └───────────┘         │            │
        │                                            │            │
        └──────────────────┬─────────────────────────┴────────────┘
                           │
                    ┌──────┴──────┐
                    │     app     │
                    └─────────────┘
```

## Development

```bash
pnpm install
pnpm build
pnpm dev
```

## License

Apache-2.0
