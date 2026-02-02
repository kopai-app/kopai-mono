| title              | impact | tags                                    |
| ------------------ | ------ | --------------------------------------- |
| Go Instrumentation | HIGH   | lang, go, golang, traces, logs, metrics |

## Go Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for Go applications with traces, logs, and metrics.

### Configuration

**Environment Variables:**
| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (e.g., `http://localhost:4318`) |
| `OTEL_SERVICE_NAME` | Service name shown in observability backend |

### Install

```bash
go get go.opentelemetry.io/otel
go get go.opentelemetry.io/otel/sdk
go get go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp
go get go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp
go get go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp
go get go.opentelemetry.io/otel/sdk/log
go get go.opentelemetry.io/otel/sdk/metric
```

### Complete Setup (All Three Signals)

```go
package main

import (
    "context"
    "log"
    "os"
    "strings"
    "time"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
    "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    otellog "go.opentelemetry.io/otel/log"
    "go.opentelemetry.io/otel/log/global"
    "go.opentelemetry.io/otel/metric"
    sdklog "go.opentelemetry.io/otel/sdk/log"
    sdkmetric "go.opentelemetry.io/otel/sdk/metric"
    "go.opentelemetry.io/otel/sdk/resource"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.26.0" // Use latest: https://pkg.go.dev/go.opentelemetry.io/otel/semconv
)

// Module-level tracer, meter, logger (initialized once)
var (
    tracer       = otel.Tracer("my-service")
    meter        = otel.Meter("my-service")
    logger       otellog.Logger
    helloCounter metric.Int64Counter
)

// Strip protocol prefix from endpoint for SDK
func stripProtocol(endpoint string) string {
    endpoint = strings.TrimPrefix(endpoint, "http://")
    endpoint = strings.TrimPrefix(endpoint, "https://")
    return endpoint
}

func initOTel(ctx context.Context) (func(context.Context) error, error) {
    endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    if endpoint == "" {
        endpoint = "http://localhost:4318"
    }
    serviceName := os.Getenv("OTEL_SERVICE_NAME")
    if serviceName == "" {
        serviceName = "my-service"
    }

    // Create resource with default attributes + service name
    res, err := resource.Merge(
        resource.Default(),
        resource.NewWithAttributes(
            semconv.SchemaURL,
            semconv.ServiceName(serviceName),
        ),
    )
    if err != nil {
        return nil, err
    }

    // Traces
    traceExp, err := otlptracehttp.New(ctx,
        otlptracehttp.WithEndpoint(stripProtocol(endpoint)),
        otlptracehttp.WithInsecure(),
    )
    if err != nil {
        return nil, err
    }
    tp := sdktrace.NewTracerProvider(
        sdktrace.WithBatcher(traceExp),
        sdktrace.WithResource(res),
    )
    otel.SetTracerProvider(tp)

    // Metrics
    metricExp, err := otlpmetrichttp.New(ctx,
        otlpmetrichttp.WithEndpoint(stripProtocol(endpoint)),
        otlpmetrichttp.WithInsecure(),
    )
    if err != nil {
        return nil, err
    }
    mp := sdkmetric.NewMeterProvider(
        sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp,
            sdkmetric.WithInterval(5*time.Second))),
        sdkmetric.WithResource(res),
    )
    otel.SetMeterProvider(mp)

    // Logs
    logExp, err := otlploghttp.New(ctx,
        otlploghttp.WithEndpoint(stripProtocol(endpoint)),
        otlploghttp.WithInsecure(),
    )
    if err != nil {
        return nil, err
    }
    lp := sdklog.NewLoggerProvider(
        sdklog.WithProcessor(sdklog.NewBatchProcessor(logExp)),
        sdklog.WithResource(res),
    )
    global.SetLoggerProvider(lp)
    logger = lp.Logger("my-service")

    // Initialize counter
    helloCounter, _ = meter.Int64Counter("hello.requests",
        metric.WithDescription("Number of hello requests"))

    // Return shutdown function
    return func(ctx context.Context) error {
        var errs []error
        if err := tp.Shutdown(ctx); err != nil {
            errs = append(errs, err)
        }
        if err := mp.Shutdown(ctx); err != nil {
            errs = append(errs, err)
        }
        if err := lp.Shutdown(ctx); err != nil {
            errs = append(errs, err)
        }
        if len(errs) > 0 {
            return errs[0]
        }
        return nil
    }, nil
}

func main() {
    ctx := context.Background()
    shutdown, err := initOTel(ctx)
    if err != nil {
        log.Fatal(err)
    }
    defer func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        shutdown(ctx)
    }()

    // Usage example
    ctx, span := tracer.Start(ctx, "my-operation")
    span.SetAttributes(attribute.String("key", "value"))
    helloCounter.Add(ctx, 1, metric.WithAttributes(attribute.String("endpoint", "/hello")))
    span.End()
}
```

### Example

See the complete working example: [kopai-integration-examples/go](https://github.com/kopai-app/kopai-integration-examples/tree/main/go)

### Reference

[OpenTelemetry Go](https://opentelemetry.io/docs/languages/go/)
