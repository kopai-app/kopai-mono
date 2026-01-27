| title                | impact | tags       |
| -------------------- | ------ | ---------- |
| Rust Instrumentation | HIGH   | lang, rust |

## Rust Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for Rust applications.

### Cargo.toml

```toml
[dependencies]
opentelemetry = "0.21"
opentelemetry_sdk = "0.21"
opentelemetry-otlp = "0.14"
```

### Example

```rust
use opentelemetry::global;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::trace::TracerProvider;

fn init_tracer() -> TracerProvider {
    opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(opentelemetry_otlp::new_exporter().http())
        .install_batch(opentelemetry_sdk::runtime::Tokio)
        .unwrap()
}
```

### Reference

[OpenTelemetry Rust](https://opentelemetry.io/docs/languages/rust/)
