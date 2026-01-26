# Kopai

Monorepo for Kopai packages.

## Packages

| Package                                                  | Description               |
| -------------------------------------------------------- | ------------------------- |
| [@kopai/tsconfig](./packages/tsconfig)                   | Shared TypeScript config  |
| [@kopai/core](./packages/core)                           | Core logic and types      |
| [@kopai/sdk](./packages/sdk)                             | SDK                       |
| [@kopai/cli](./packages/cli)                             | CLI tool                  |
| [@kopai/api](./packages/api)                             | OTEL signals API          |
| [@kopai/ui](./packages/ui)                               | TBA                       |
| [@kopai/collector](./packages/collector)                 | OTLP collector, HTTP only |
| [@kopai/sqlite-datasource](./packages/sqlite-datasource) | SQLite datasource         |
| [@kopai/app](./packages/app)                             | Local OTEL Backend        |

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0
