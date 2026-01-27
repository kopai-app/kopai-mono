| title              | impact | tags             |
| ------------------ | ------ | ---------------- |
| Go Instrumentation | HIGH   | lang, go, golang |

## Go Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for Go applications.

### Install

```bash
go get go.opentelemetry.io/otel
go get go.opentelemetry.io/otel/sdk
go get go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp
```

### Example

```go
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/sdk/trace"
)

func initTracer() (*trace.TracerProvider, error) {
    exporter, err := otlptracehttp.New(context.Background())
    if err != nil {
        return nil, err
    }
    tp := trace.NewTracerProvider(trace.WithBatcher(exporter))
    otel.SetTracerProvider(tp)
    return tp, nil
}
```

### Reference

https://opentelemetry.io/docs/languages/go/
