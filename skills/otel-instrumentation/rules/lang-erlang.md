| title                         | impact | tags                       |
| ----------------------------- | ------ | -------------------------- |
| Erlang/Elixir Instrumentation | HIGH   | lang, erlang, elixir, beam |

## Erlang/Elixir Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for Erlang/Elixir applications.

### Elixir (mix.exs)

```elixir
defp deps do
  [
    {:opentelemetry, "~> 1.0"},
    {:opentelemetry_exporter, "~> 1.0"}
  ]
end
```

### Erlang (rebar.config)

```erlang
{deps, [
    {opentelemetry, "~> 1.0"},
    {opentelemetry_exporter, "~> 1.0"}
]}.
```

### Config (config/runtime.exs)

```elixir
config :opentelemetry,
  span_processor: :batch,
  traces_exporter: :otlp

config :opentelemetry_exporter,
  otlp_protocol: :http_protobuf,
  otlp_endpoint: "http://localhost:4318"
```

### Reference

https://opentelemetry.io/docs/languages/erlang/
