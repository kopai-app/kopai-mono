# Kopai

Monorepo for Kopai packages.

## Packages

| Package                                                  | Description               | Version                                                                    |
| -------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------- |
| [@kopai/tsconfig](./packages/tsconfig)                   | Shared TypeScript config  |                                                                            |
| [@kopai/core](./packages/core)                           | Core logic and types      | ![npm](https://img.shields.io/npm/v/@kopai/core?label=latest)              |
| [@kopai/sdk](./packages/sdk)                             | SDK                       | ![npm](https://img.shields.io/npm/v/@kopai/sdk?label=latest)               |
| [@kopai/cli](./packages/cli)                             | CLI tool                  | ![npm](https://img.shields.io/npm/v/@kopai/cli?label=latest)               |
| [@kopai/api](./packages/api)                             | OTEL signals API          | ![npm](https://img.shields.io/npm/v/@kopai/api?label=latest)               |
| [@kopai/ui](./packages/ui)                               | TBA                       | ![npm](https://img.shields.io/npm/v/@kopai/ui?label=latest)                |
| [@kopai/collector](./packages/collector)                 | OTLP collector, HTTP only | ![npm](https://img.shields.io/npm/v/@kopai/collector?label=latest)         |
| [@kopai/sqlite-datasource](./packages/sqlite-datasource) | SQLite datasource         | ![npm](https://img.shields.io/npm/v/@kopai/sqlite-datasource?label=latest) |
| [@kopai/app](./packages/app)                             | Local OTEL Backend        | ![npm](https://img.shields.io/npm/v/@kopai/app?label=latest)               |

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
