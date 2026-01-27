| title                 | impact | tags             |
| --------------------- | ------ | ---------------- |
| Swift Instrumentation | HIGH   | lang, swift, ios |

## Swift Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for Swift applications.

### Swift Package Manager

```swift
dependencies: [
    .package(url: "https://github.com/open-telemetry/opentelemetry-swift", from: "1.0.0")
]
```

### Example

```swift
import OpenTelemetryApi
import OpenTelemetrySdk
import OtlpExporter

let exporter = OtlpHttpTraceExporter()
let processor = SimpleSpanProcessor(spanExporter: exporter)
let provider = TracerProviderBuilder()
    .add(spanProcessor: processor)
    .build()
OpenTelemetry.registerTracerProvider(tracerProvider: provider)
```

### Reference

https://opentelemetry.io/docs/languages/swift/
