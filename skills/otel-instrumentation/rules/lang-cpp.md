| title               | impact | tags                                  |
| ------------------- | ------ | ------------------------------------- |
| C++ Instrumentation | HIGH   | lang, cpp, c++, traces, logs, metrics |

## C++ Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for C++ applications with traces, logs, and metrics using OTLP HTTP exporters.

### CMake

```cmake
find_package(opentelemetry-cpp CONFIG REQUIRED)
target_link_libraries(myapp PRIVATE
    opentelemetry_trace
    opentelemetry_logs
    opentelemetry_metrics
    opentelemetry_exporter_otlp_http
    opentelemetry_exporter_otlp_http_log
    opentelemetry_exporter_otlp_http_metric
)
```

### Configuration

```cpp
#include <cstdlib>
#include <string>

std::string getEndpoint() {
    const char* env = std::getenv("OTEL_EXPORTER_OTLP_ENDPOINT");
    return env ? env : "http://localhost:4318";
}

std::string getServiceName() {
    const char* env = std::getenv("OTEL_SERVICE_NAME");
    return env ? env : "my-service";
}
```

**Environment Variables:**
| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (e.g., `http://localhost:4318`) |
| `OTEL_SERVICE_NAME` | Service name shown in observability backend |

### Resource Configuration

```cpp
#include "opentelemetry/sdk/resource/resource.h"
#include "opentelemetry/sdk/resource/semantic_conventions.h"

namespace resource = opentelemetry::sdk::resource;

resource::Resource createResource() {
    return resource::Resource::Create({
        {resource::SemanticConventions::kServiceName, getServiceName()},
        {"telemetry.sdk.language", "cpp"}
    });
}
```

### Traces

```cpp
#include "opentelemetry/exporters/otlp/otlp_http_exporter_factory.h"
#include "opentelemetry/exporters/otlp/otlp_http_exporter_options.h"
#include "opentelemetry/sdk/trace/tracer_provider_factory.h"
#include "opentelemetry/sdk/trace/tracer_provider.h"
#include "opentelemetry/sdk/trace/batch_span_processor_factory.h"
#include "opentelemetry/sdk/trace/batch_span_processor_options.h"
#include "opentelemetry/trace/provider.h"

namespace trace_api = opentelemetry::trace;
namespace trace_sdk = opentelemetry::sdk::trace;
namespace trace_exporter = opentelemetry::exporter::otlp;

void InitTracer() {
    trace_exporter::OtlpHttpExporterOptions opts;
    opts.url = getEndpoint() + "/v1/traces";

    auto exporter = trace_exporter::OtlpHttpExporterFactory::Create(opts);

    trace_sdk::BatchSpanProcessorOptions processor_opts;
    processor_opts.max_queue_size = 2048;
    processor_opts.max_export_batch_size = 512;

    auto processor = trace_sdk::BatchSpanProcessorFactory::Create(
        std::move(exporter), processor_opts);

    std::shared_ptr<trace_api::TracerProvider> provider =
        trace_sdk::TracerProviderFactory::Create(
            std::move(processor), createResource());

    trace_api::Provider::SetTracerProvider(provider);
}

// Create spans
auto tracer = trace_api::Provider::GetTracerProvider()->GetTracer("my-app");
auto span = tracer->StartSpan("my-operation");
auto scope = tracer->WithActiveSpan(span);
span->SetAttribute("key", "value");
// Your code here
span->SetStatus(trace_api::StatusCode::kOk);
span->End();
```

### Logs

```cpp
#include "opentelemetry/exporters/otlp/otlp_http_log_record_exporter_factory.h"
#include "opentelemetry/exporters/otlp/otlp_http_log_record_exporter_options.h"
#include "opentelemetry/sdk/logs/logger_provider_factory.h"
#include "opentelemetry/sdk/logs/logger_provider.h"
#include "opentelemetry/sdk/logs/simple_log_record_processor_factory.h"
#include "opentelemetry/logs/provider.h"

namespace logs_api = opentelemetry::logs;
namespace logs_sdk = opentelemetry::sdk::logs;
namespace logs_exporter = opentelemetry::exporter::otlp;

void InitLogger() {
    logs_exporter::OtlpHttpLogRecordExporterOptions opts;
    opts.url = getEndpoint() + "/v1/logs";

    auto exporter = logs_exporter::OtlpHttpLogRecordExporterFactory::Create(opts);

    auto processor = logs_sdk::SimpleLogRecordProcessorFactory::Create(
        std::move(exporter));

    std::shared_ptr<logs_api::LoggerProvider> provider =
        logs_sdk::LoggerProviderFactory::Create(
            std::move(processor), createResource());

    logs_api::Provider::SetLoggerProvider(provider);
}

// Create logs
auto logger = logs_api::Provider::GetLoggerProvider()->GetLogger("my-app");
logger->Info("Application started");
logger->Warn("Warning message");
logger->Error("Error occurred");
```

### Metrics

```cpp
#include "opentelemetry/exporters/otlp/otlp_http_metric_exporter_factory.h"
#include "opentelemetry/exporters/otlp/otlp_http_metric_exporter_options.h"
#include "opentelemetry/sdk/metrics/meter_provider_factory.h"
#include "opentelemetry/sdk/metrics/meter_provider.h"
#include "opentelemetry/sdk/metrics/meter_context_factory.h"
#include "opentelemetry/sdk/metrics/export/periodic_exporting_metric_reader_factory.h"
#include "opentelemetry/sdk/metrics/export/periodic_exporting_metric_reader_options.h"
#include "opentelemetry/metrics/provider.h"

namespace metrics_api = opentelemetry::metrics;
namespace metrics_sdk = opentelemetry::sdk::metrics;
namespace metrics_exporter = opentelemetry::exporter::otlp;

void InitMeter() {
    metrics_exporter::OtlpHttpMetricExporterOptions opts;
    opts.url = getEndpoint() + "/v1/metrics";

    auto exporter = metrics_exporter::OtlpHttpMetricExporterFactory::Create(opts);

    metrics_sdk::PeriodicExportingMetricReaderOptions reader_opts;
    reader_opts.export_interval_millis = std::chrono::milliseconds(5000);
    reader_opts.export_timeout_millis = std::chrono::milliseconds(500);

    auto reader = metrics_sdk::PeriodicExportingMetricReaderFactory::Create(
        std::move(exporter), reader_opts);

    auto context = metrics_sdk::MeterContextFactory::Create();
    context->AddMetricReader(std::move(reader));

    std::shared_ptr<metrics_api::MeterProvider> provider =
        metrics_sdk::MeterProviderFactory::Create(std::move(context));

    metrics_api::Provider::SetMeterProvider(provider);
}

// Create metrics
auto meter = metrics_api::Provider::GetMeterProvider()->GetMeter("my-app");
auto counter = meter->CreateUInt64Counter("requests", "Number of requests");
counter->Add(1, {{"endpoint", "/api"}});

auto histogram = meter->CreateDoubleHistogram("latency", "Request latency");
histogram->Record(0.123, {{"endpoint", "/api"}});
```

### Shutdown

```cpp
void CleanupProviders() {
    auto tracer_provider = trace_api::Provider::GetTracerProvider();
    if (auto* tp = dynamic_cast<trace_sdk::TracerProvider*>(tracer_provider.get())) {
        tp->Shutdown();
    }

    auto meter_provider = metrics_api::Provider::GetMeterProvider();
    if (auto* mp = dynamic_cast<metrics_sdk::MeterProvider*>(meter_provider.get())) {
        mp->Shutdown();
    }

    auto logger_provider = logs_api::Provider::GetLoggerProvider();
    if (auto* lp = dynamic_cast<logs_sdk::LoggerProvider*>(logger_provider.get())) {
        lp->Shutdown();
    }
}
```

### Reference

- [OpenTelemetry C++](https://opentelemetry.io/docs/languages/cpp/)
- [opentelemetry-cpp GitHub](https://github.com/open-telemetry/opentelemetry-cpp)
