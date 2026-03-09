# Kopai

OpenTelemetry observability backend in TypeScript running on Node.js

Run with

```
npx @kopai/app start
```

- send OpenTelemetry signals to localhost:4318 using HTTP
- inspect the data using [`@kopai/cli`](./packages/cli)
- view traces, logs and metrics in your browser at localhost:8000

See: [OpenTelemetry Demo App running with @kopai/app](https://github.com/kopai-app/opentelemetry-demo/tree/main/kopai).

## Docker

A public Docker image is available on GitHub Container Registry:

```
docker run --rm -p 8000:8000 -p 4318:4318 ghcr.io/kopai-app/kopai:latest
```

The image is built on [Docker Hardened Images](https://hub.docker.com/hardened-images) (`dhi.io/node:24-debian13`) and published automatically on each release.

## Packages

| Package                                                          | Description                | Version                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [@kopai/app](./packages/app)                                     | Local OTEL Backend         | [![npm](https://img.shields.io/npm/v/@kopai/app?label=latest)](https://www.npmjs.com/package/@kopai/app)                                     |
| [@kopai/core](./packages/core)                                   | Core logic and types       | [![npm](https://img.shields.io/npm/v/@kopai/core?label=latest)](https://www.npmjs.com/package/@kopai/core)                                   |
| [@kopai/sdk](./packages/sdk)                                     | SDK                        | [![npm](https://img.shields.io/npm/v/@kopai/sdk?label=latest)](https://www.npmjs.com/package/@kopai/sdk)                                     |
| [@kopai/cli](./packages/cli)                                     | CLI tool                   | [![npm](https://img.shields.io/npm/v/@kopai/cli?label=latest)](https://www.npmjs.com/package/@kopai/cli)                                     |
| [@kopai/api](./packages/api)                                     | OTEL signals API           | [![npm](https://img.shields.io/npm/v/@kopai/api?label=latest)](https://www.npmjs.com/package/@kopai/api)                                     |
| [@kopai/ui](./packages/ui)                                       | Dashboard React components | [![npm](https://img.shields.io/npm/v/@kopai/ui?label=latest)](https://www.npmjs.com/package/@kopai/ui)                                       |
| [@kopai/collector](./packages/collector)                         | OTLP collector, HTTP only  | [![npm](https://img.shields.io/npm/v/@kopai/collector?label=latest)](https://www.npmjs.com/package/@kopai/collector)                         |
| [@kopai/sqlite-datasource](./packages/sqlite-datasource)         | SQLite datasource          | [![npm](https://img.shields.io/npm/v/@kopai/sqlite-datasource?label=latest)](https://www.npmjs.com/package/@kopai/sqlite-datasource)         |
| [@kopai/clickhouse-datasource](./packages/clickhouse-datasource) | ClickHouse datasource      | [![npm](https://img.shields.io/npm/v/@kopai/clickhouse-datasource?label=latest)](https://www.npmjs.com/package/@kopai/clickhouse-datasource) |
| [@kopai/tsconfig](./packages/tsconfig)                           | Shared TypeScript config   |                                                                                                                                              |

## Examples

| Example                                                                         | Description                                              |
| ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [clickhouse-observability-backend](./examples/clickhouse-observability-backend) | Docker Compose: OTEL Collector → ClickHouse → @kopai/api |

### Dependency Graph

```
                                    ┌─────────────┐
                                    │  tsconfig   │
                                    └──────▲──────┘
                                           │
                                    ┌──────┴──────┐
        ┌────────────┬──────────────┤    core     ├──────────────┬────────────┬──────────────┐
        │            │              └──────▲──────┘              │            │              │
        │            │                     │                     │            │              │
  ┌─────┴─────┐ ┌────┴────┐         ┌──────┴──────┐        ┌─────┴─────┐ ┌────┴─────┐ ┌──────┴─────┐
  │    api    │ │   ui    │         │     sdk     │        │ collector │ │ sqlite-  │ │clickhouse- │
  └─────▲─────┘ └────▲────┘         └──────▲──────┘        └─────▲─────┘ │datasource│ │ datasource │
        │            │                     │                     │       └────▲─────┘ └────────────┘
        │            │               ┌─────┴─────┐               │            │
        │            │               │    cli    │               │            │
        │            │               └───────────┘               │            │
        │            │                                           │            │
        └────────────┴───────┬───────────────────────────────────┴────────────┘
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
