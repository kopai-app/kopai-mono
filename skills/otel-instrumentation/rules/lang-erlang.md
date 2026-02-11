| title                         | impact | tags                                              |
| ----------------------------- | ------ | ------------------------------------------------- |
| Erlang/Elixir Instrumentation | HIGH   | lang, erlang, elixir, beam, traces, logs, metrics |

## Erlang/Elixir Instrumentation

**Impact:** HIGH

Set up OpenTelemetry for Erlang/Elixir applications with traces, logs, and metrics.

**SDK Status:**

| Signal  | Support     | Notes                                                     |
| ------- | ----------- | --------------------------------------------------------- |
| Traces  | SDK         | Mature, use opentelemetry_cowboy for auto-instrumentation |
| Logs    | Direct HTTP | No official OTLP log exporter available                   |
| Metrics | Direct HTTP | No official OTLP metric exporter available                |

### Elixir (mix.exs)

**Note:** Replace `X.X` with the latest versions from [hex.pm](https://hex.pm).

```elixir
defp deps do
  [
    # OpenTelemetry SDK
    {:opentelemetry_api, "~> X.X"},
    {:opentelemetry, "~> X.X"},
    {:opentelemetry_exporter, "~> X.X"},
    {:opentelemetry_cowboy, "~> X.X"},  # Auto-instrumentation for Cowboy/Plug

    # For direct HTTP/JSON (logs and metrics)
    {:jason, "~> X.X"}
  ]
end
```

### Configuration

**config/config.exs:**

```elixir
import Config

config :opentelemetry,
  span_processor: :batch,
  traces_exporter: :otlp

config :opentelemetry_exporter,
  otlp_protocol: :http_json,      # Use JSON format
  otlp_compression: :none         # Required for some backends
```

**config/runtime.exs:**

```elixir
import Config

otel_endpoint = System.get_env("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
service_name = System.get_env("OTEL_SERVICE_NAME", "my-service")

config :opentelemetry,
  resource: [
    service: [
      name: service_name,
      namespace: "my-namespace"
    ]
  ]

config :opentelemetry_exporter,
  otlp_endpoint: otel_endpoint
```

**Environment Variables:**
| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (e.g., `http://localhost:4318`) |
| `OTEL_SERVICE_NAME` | Service name shown in observability backend |

### Traces (SDK)

```elixir
defmodule MyApp.Application do
  use Application

  def start(_type, _args) do
    # Initialize auto-instrumentation for Cowboy
    :opentelemetry_cowboy.setup()

    children = [
      {Plug.Cowboy, scheme: :http, plug: MyApp.Router, options: [port: 3001]}
    ]

    Supervisor.start_link(children, strategy: :one_for_one)
  end
end

defmodule MyApp.Router do
  use Plug.Router
  require OpenTelemetry.Tracer, as: Tracer

  plug :match
  plug :dispatch

  get "/hello" do
    Tracer.with_span "process_request" do
      Tracer.set_attributes([
        {"http.method", "GET"},
        {"http.route", "/hello"},
        {"custom.attribute", "value"}
      ])

      # Your code here
    end

    send_resp(conn, 200, "Hello!")
  end
end
```

### Logs (Direct HTTP)

No official OTLP log exporter exists for Elixir. Use direct HTTP/JSON:

```elixir
defp send_log(message, endpoint, service_name) do
  timestamp = System.system_time(:nanosecond)

  body = %{
    resourceLogs: [%{
      resource: %{attributes: [
        %{key: "service.name", value: %{stringValue: service_name}}
      ]},
      scopeLogs: [%{
        scope: %{name: service_name},
        logRecords: [%{
          timeUnixNano: to_string(timestamp),
          severityText: "INFO",
          severityNumber: 9,
          body: %{stringValue: message}
        }]
      }]
    }]
  }

  send_otlp_request("#{endpoint}/v1/logs", body)
end
```

### Metrics (Direct HTTP)

No official OTLP metric exporter exists for Elixir. Use direct HTTP/JSON:

```elixir
defp send_metric(name, value, endpoint, service_name, attributes) do
  timestamp = System.system_time(:nanosecond)

  attrs = Enum.map(attributes, fn {k, v} ->
    %{key: k, value: %{stringValue: v}}
  end)

  body = %{
    resourceMetrics: [%{
      resource: %{attributes: [
        %{key: "service.name", value: %{stringValue: service_name}}
      ]},
      scopeMetrics: [%{
        scope: %{name: service_name},
        metrics: [%{
          name: name, unit: "1",
          sum: %{
            dataPoints: [%{
              asInt: to_string(value),
              timeUnixNano: to_string(timestamp),
              attributes: attrs
            }],
            aggregationTemporality: 2, isMonotonic: true
          }
        }]
      }]
    }]
  }

  send_otlp_request("#{endpoint}/v1/metrics", body)
end
```

### HTTP Helper (for logs and metrics)

```elixir
defp send_otlp_request(url, body) do
  url_charlist = String.to_charlist(url)
  json_body = Jason.encode!(body)

  case :httpc.request(
    :post,
    {url_charlist, [{~c"content-type", ~c"application/json"}], ~c"application/json", json_body},
    [{:timeout, 5000}],
    []
  ) do
    {:ok, _response} -> :ok
    {:error, reason} ->
      IO.puts("OTLP request to #{url} failed: #{inspect(reason)}")
      {:error, reason}
  end
rescue
  error ->
    IO.puts("OTLP request to #{url} raised: #{inspect(error)}")
    {:error, error}
end
```

### Important Notes

1. **Auto-instrumentation**: Call `:opentelemetry_cowboy.setup()` to enable automatic HTTP span creation.

2. **HTTP JSON Protocol**: Use `otlp_protocol: :http_json` for JSON format export.

3. **Compression**: Set `otlp_compression: :none` for compatibility with some backends.

4. **Charlist Syntax (Elixir 1.18+)**: Use `~c""` sigil instead of single quotes for charlists.

5. **Logs/Metrics**: Use direct HTTP/JSON until official OTLP exporters are available.

### Reference

[OpenTelemetry Erlang](https://opentelemetry.io/docs/languages/erlang/)
