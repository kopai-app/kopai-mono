| title               | impact | tags           |
| ------------------- | ------ | -------------- |
| C++ Instrumentation | HIGH   | lang, cpp, c++ |

## C++ Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for C++ applications.

### CMake

```cmake
find_package(opentelemetry-cpp CONFIG REQUIRED)
target_link_libraries(myapp
    opentelemetry-cpp::trace
    opentelemetry-cpp::otlp_http_exporter
)
```

### Example

```cpp
#include <opentelemetry/exporters/otlp/otlp_http_exporter_factory.h>
#include <opentelemetry/sdk/trace/tracer_provider_factory.h>
#include <opentelemetry/trace/provider.h>

auto exporter = otlp::OtlpHttpExporterFactory::Create();
auto provider = trace_sdk::TracerProviderFactory::Create(
    std::move(exporter));
trace_api::Provider::SetTracerProvider(std::move(provider));
```

### Reference

https://opentelemetry.io/docs/languages/cpp/
