| title                | impact | tags                              |
| -------------------- | ------ | --------------------------------- |
| Ruby Instrumentation | HIGH   | lang, ruby, traces, logs, metrics |

## Ruby Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for Ruby applications with traces, logs, and metrics.

### Install

In Gemfile:

```ruby
# OpenTelemetry SDK - Core
gem 'opentelemetry-sdk'

# OpenTelemetry - Traces
gem 'opentelemetry-exporter-otlp'

# OpenTelemetry - Metrics (experimental)
gem 'opentelemetry-metrics-sdk'
gem 'opentelemetry-exporter-otlp-metrics'

# OpenTelemetry - Logs (experimental)
gem 'opentelemetry-logs-sdk'
gem 'opentelemetry-exporter-otlp-logs'

# Framework instrumentations (optional)
gem 'opentelemetry-instrumentation-sinatra'  # for Sinatra
gem 'opentelemetry-instrumentation-rails'    # for Rails
```

Then run:

```bash
bundle install
```

### Configuration

```ruby
OTEL_ENDPOINT = ENV['OTEL_EXPORTER_OTLP_ENDPOINT'] || 'http://localhost:4318'
SERVICE_NAME = ENV['OTEL_SERVICE_NAME'] || 'my-service'
```

**Environment Variables:**
| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (e.g., `http://localhost:4318`) |
| `OTEL_SERVICE_NAME` | Service name shown in observability backend |

### Traces (SDK)

```ruby
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'
require 'opentelemetry/instrumentation/sinatra'  # for Sinatra apps

OTEL_ENDPOINT = ENV['OTEL_EXPORTER_OTLP_ENDPOINT'] || 'http://localhost:4318'
SERVICE_NAME = ENV['OTEL_SERVICE_NAME'] || 'my-service'
TRACES_ENDPOINT = "#{OTEL_ENDPOINT}/v1/traces"

# Create trace exporter with explicit endpoint
# Use compression: 'none' if your backend doesn't support gzip
trace_exporter = OpenTelemetry::Exporter::OTLP::Exporter.new(
  endpoint: TRACES_ENDPOINT,
  compression: 'none'  # or 'gzip' if supported
)

OpenTelemetry::SDK.configure do |c|
  c.service_name = SERVICE_NAME
  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(trace_exporter)
  )
  # Enable auto-instrumentation for frameworks
  c.use 'OpenTelemetry::Instrumentation::Sinatra'
end

# Create custom spans
tracer = OpenTelemetry.tracer_provider.tracer(SERVICE_NAME)
tracer.in_span('my-operation', attributes: { 'key' => 'value' }) do |span|
  span.set_attribute('custom.attribute', true)
  # Your code here
end
```

### Logs (SDK - Experimental)

```ruby
require 'opentelemetry-logs-sdk'
require 'opentelemetry-exporter-otlp-logs'

OTEL_ENDPOINT = ENV['OTEL_EXPORTER_OTLP_ENDPOINT'] || 'http://localhost:4318'
SERVICE_NAME = ENV['OTEL_SERVICE_NAME'] || 'my-service'

begin
  resource = OpenTelemetry::SDK::Resources::Resource.create(
    'service.name' => SERVICE_NAME,
    'telemetry.sdk.language' => 'ruby'
  )

  logs_endpoint = "#{OTEL_ENDPOINT}/v1/logs"
  logger_provider = OpenTelemetry::SDK::Logs::LoggerProvider.new(resource: resource)

  logs_processor = OpenTelemetry::SDK::Logs::Export::BatchLogRecordProcessor.new(
    OpenTelemetry::Exporter::OTLP::Logs::LogsExporter.new(
      endpoint: logs_endpoint,
      compression: 'none'  # or 'gzip' if supported
    )
  )
  logger_provider.add_log_record_processor(logs_processor)

  otel_logger = logger_provider.logger(name: SERVICE_NAME)

  # Emit a log record
  otel_logger.on_emit(
    timestamp: Time.now,
    severity_text: 'INFO',
    body: 'User logged in',
    attributes: { 'user.id' => '123' }
  )
rescue LoadError => e
  puts "Logs SDK not available: #{e.message}"
end
```

### Metrics (SDK - Experimental)

```ruby
require 'opentelemetry-metrics-sdk'
require 'opentelemetry/exporter/otlp_metrics'

OTEL_ENDPOINT = ENV['OTEL_EXPORTER_OTLP_ENDPOINT'] || 'http://localhost:4318'
SERVICE_NAME = ENV['OTEL_SERVICE_NAME'] || 'my-service'

begin
  resource = OpenTelemetry::SDK::Resources::Resource.create(
    'service.name' => SERVICE_NAME,
    'telemetry.sdk.language' => 'ruby'
  )

  metrics_endpoint = "#{OTEL_ENDPOINT}/v1/metrics"
  metrics_exporter = OpenTelemetry::Exporter::OTLP::Metrics::MetricsExporter.new(
    endpoint: metrics_endpoint,
    compression: 'none'  # or 'gzip' if supported
  )

  meter_provider = OpenTelemetry::SDK::Metrics::MeterProvider.new(resource: resource)
  meter_provider.add_metric_reader(metrics_exporter)

  # Set as global meter provider
  OpenTelemetry.meter_provider = meter_provider

  meter = meter_provider.meter(SERVICE_NAME)
  request_counter = meter.create_counter(
    'http.requests',
    unit: '1',
    description: 'Number of HTTP requests'
  )

  # Increment counter
  request_counter.add(1, attributes: { 'endpoint' => '/api/users' })
rescue LoadError => e
  puts "Metrics SDK not available: #{e.message}"
end
```

### Important Notes

1. **Compression**: Use `compression: 'none'` if your OTLP backend doesn't support gzip. The Ruby OTLP exporter uses gzip by default.

2. **Framework Integration**: Don't use `at_exit` handlers with Sinatra - they conflict with Sinatra's process management. The SDK handles cleanup automatically.

3. **Experimental APIs**: The logs and metrics SDKs are experimental. Wrap their initialization in begin/rescue blocks to handle missing gems gracefully.

4. **Endpoint Format**: Use the full endpoint with signal path (e.g., `/v1/traces`) when explicitly configuring exporters.

### Reference

[OpenTelemetry Ruby](https://opentelemetry.io/docs/languages/ruby/)
