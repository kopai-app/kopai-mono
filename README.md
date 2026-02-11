# Kopai

Monorepo for Kopai packages.

## Packages

| Package                                                  | Description               | Version                                                                                                                              |
| -------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [@kopai/tsconfig](./packages/tsconfig)                   | Shared TypeScript config  |                                                                                                                                      |
| [@kopai/core](./packages/core)                           | Core logic and types      | [![npm](https://img.shields.io/npm/v/@kopai/core?label=latest)](https://www.npmjs.com/package/@kopai/core)                           |
| [@kopai/sdk](./packages/sdk)                             | SDK                       | [![npm](https://img.shields.io/npm/v/@kopai/sdk?label=latest)](https://www.npmjs.com/package/@kopai/sdk)                             |
| [@kopai/cli](./packages/cli)                             | CLI tool                  | [![npm](https://img.shields.io/npm/v/@kopai/cli?label=latest)](https://www.npmjs.com/package/@kopai/cli)                             |
| [@kopai/api](./packages/api)                             | OTEL signals API          | [![npm](https://img.shields.io/npm/v/@kopai/api?label=latest)](https://www.npmjs.com/package/@kopai/api)                             |
| [@kopai/ui](./packages/ui)                               | TBA                       | [![npm](https://img.shields.io/npm/v/@kopai/ui?label=latest)](https://www.npmjs.com/package/@kopai/ui)                               |
| [@kopai/collector](./packages/collector)                 | OTLP collector, HTTP only | [![npm](https://img.shields.io/npm/v/@kopai/collector?label=latest)](https://www.npmjs.com/package/@kopai/collector)                 |
| [@kopai/sqlite-datasource](./packages/sqlite-datasource) | SQLite datasource         | [![npm](https://img.shields.io/npm/v/@kopai/sqlite-datasource?label=latest)](https://www.npmjs.com/package/@kopai/sqlite-datasource) |
| [@kopai/app](./packages/app)                             | Local OTEL Backend        | [![npm](https://img.shields.io/npm/v/@kopai/app?label=latest)](https://www.npmjs.com/package/@kopai/app)                             |

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
