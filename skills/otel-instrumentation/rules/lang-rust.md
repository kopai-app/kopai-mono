| title                | impact | tags                              |
| -------------------- | ------ | --------------------------------- |
| Rust Instrumentation | HIGH   | lang, rust, traces, logs, metrics |

## Rust Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for Rust applications with traces, logs, and metrics.

### Cargo.toml

```toml
[dependencies]
# Web framework (optional)
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }

# OpenTelemetry SDK
opentelemetry = "0.31"
opentelemetry_sdk = { version = "0.31", features = ["rt-tokio"] }
opentelemetry-otlp = { version = "0.31", features = ["http-proto", "http-json", "logs"] }

# Logging integration
opentelemetry-appender-tracing = "0.31"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

### Configuration

```rust
use std::env;

fn get_endpoint() -> String {
    env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .unwrap_or_else(|_| "http://localhost:4318".to_string())
}

fn get_service_name() -> String {
    env::var("OTEL_SERVICE_NAME")
        .unwrap_or_else(|_| "my-service".to_string())
}
```

**Environment Variables:**
| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (e.g., `http://localhost:4318`) |
| `OTEL_SERVICE_NAME` | Service name shown in observability backend |

### Traces (SDK)

```rust
use opentelemetry::{global, trace::{Status, TraceContextExt, Tracer}, KeyValue};
use opentelemetry_otlp::{Protocol, WithExportConfig};
use opentelemetry_sdk::{trace::SdkTracerProvider, Resource};

fn init_tracer_provider() -> SdkTracerProvider {
    let endpoint = get_endpoint();
    let service_name = get_service_name();

    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpJson)
        .with_endpoint(format!("{}/v1/traces", endpoint))
        .build()
        .expect("Failed to create span exporter");

    let resource = Resource::builder()
        .with_service_name(service_name)
        .with_attribute(KeyValue::new("telemetry.sdk.language", "rust"))
        .build();

    let provider = SdkTracerProvider::builder()
        .with_resource(resource)
        .with_batch_exporter(exporter)
        .build();

    global::set_tracer_provider(provider.clone());
    provider
}

// Usage
let tracer = global::tracer("my-service");
tracer.in_span("my-operation", |cx| {
    let span = cx.span();
    span.set_attribute(KeyValue::new("key", "value"));
    // Your code here
    span.set_status(Status::Ok);
});
```

### Metrics (SDK)

```rust
use opentelemetry::global;
use opentelemetry_otlp::{Protocol, WithExportConfig};
use opentelemetry_sdk::metrics::{PeriodicReader, SdkMeterProvider};
use std::time::Duration;

fn init_meter_provider() -> SdkMeterProvider {
    let endpoint = get_endpoint();
    let service_name = get_service_name();

    let exporter = opentelemetry_otlp::MetricExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpJson)
        .with_endpoint(format!("{}/v1/metrics", endpoint))
        .build()
        .expect("Failed to create metric exporter");

    let reader = PeriodicReader::builder(exporter)
        .with_interval(Duration::from_secs(5))
        .build();

    let resource = Resource::builder()
        .with_service_name(service_name)
        .build();

    let provider = SdkMeterProvider::builder()
        .with_resource(resource)
        .with_reader(reader)
        .build();

    global::set_meter_provider(provider.clone());
    provider
}

// Usage
let meter = global::meter("my-service");
let counter = meter.u64_counter("http.requests").build();
counter.add(1, &[KeyValue::new("endpoint", "/api/users")]);
```

### Logs (SDK)

```rust
use opentelemetry_otlp::{Protocol, WithExportConfig};
use opentelemetry_sdk::logs::SdkLoggerProvider;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

fn init_logger_provider() -> SdkLoggerProvider {
    let endpoint = get_endpoint();
    let service_name = get_service_name();

    let exporter = opentelemetry_otlp::LogExporter::builder()
        .with_http()
        .with_protocol(Protocol::HttpJson)
        .with_endpoint(format!("{}/v1/logs", endpoint))
        .build()
        .expect("Failed to create log exporter");

    let resource = Resource::builder()
        .with_service_name(service_name)
        .build();

    SdkLoggerProvider::builder()
        .with_resource(resource)
        .with_batch_exporter(exporter)
        .build()
}

// Setup tracing subscriber with OpenTelemetry bridge
fn init_tracing(logger_provider: &SdkLoggerProvider) {
    let otel_layer = OpenTelemetryTracingBridge::new(logger_provider);

    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(otel_layer)
        .init();
}

// Usage - logs via tracing macros
tracing::info!(endpoint = "/hello", "Hello endpoint called");
tracing::error!("Something went wrong");
```

### Complete Setup Example

```rust
#[tokio::main]
async fn main() {
    // Initialize OpenTelemetry providers
    let tracer_provider = init_tracer_provider();
    let meter_provider = init_meter_provider();
    let logger_provider = init_logger_provider();

    // Setup tracing subscriber with OTel bridge
    init_tracing(&logger_provider);

    // Your application code here

    // Graceful shutdown on exit
    let _ = tracer_provider.shutdown();
    let _ = meter_provider.shutdown();
    let _ = logger_provider.shutdown();
}
```

### Important Notes

1. **Static Names**: `global::tracer()` and `global::meter()` require `&'static str` names.

2. **TraceContextExt**: Import `TraceContextExt` to access `span()` on Context within `in_span`.

3. **HTTP JSON Protocol**: Use `Protocol::HttpJson` for JSON format export.

4. **Graceful Shutdown**: Always call `shutdown()` on providers before process exit.

5. **Tokio Runtime**: Requires Tokio runtime for async batching (`rt-tokio` feature).

### Reference

[OpenTelemetry Rust](https://opentelemetry.io/docs/languages/rust/)
