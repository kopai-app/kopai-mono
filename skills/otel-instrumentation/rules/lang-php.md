| title               | impact | tags                             |
| ------------------- | ------ | -------------------------------- |
| PHP Instrumentation | HIGH   | lang, php, traces, logs, metrics |

## PHP Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for PHP applications with traces, logs, and metrics.

### Install

```bash
composer require \
  open-telemetry/sdk \
  open-telemetry/exporter-otlp \
  php-http/guzzle7-adapter \
  guzzlehttp/guzzle \
  nyholm/psr7
```

### Configuration

```php
$otelEndpoint = getenv('OTEL_EXPORTER_OTLP_ENDPOINT') ?: 'http://localhost:4318';
$serviceName = getenv('OTEL_SERVICE_NAME') ?: 'my-service';
```

**Environment Variables:**
| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (e.g., `http://localhost:4318`) |
| `OTEL_SERVICE_NAME` | Service name shown in observability backend |

### Traces (SDK)

```php
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\SpanKind;
use OpenTelemetry\API\Trace\StatusCode;
use OpenTelemetry\Contrib\Otlp\SpanExporter;
use OpenTelemetry\Contrib\Otlp\ContentTypes;
use OpenTelemetry\SDK\Common\Attribute\Attributes;
use OpenTelemetry\SDK\Common\Export\Http\PsrTransportFactory;
use OpenTelemetry\SDK\Resource\ResourceInfo;
use OpenTelemetry\SDK\Resource\ResourceInfoFactory;
use OpenTelemetry\SDK\Sdk;
use OpenTelemetry\SDK\Trace\SpanProcessor\SimpleSpanProcessor;
use OpenTelemetry\SDK\Trace\TracerProvider;
use OpenTelemetry\SemConv\ResourceAttributes;

$otelEndpoint = getenv('OTEL_EXPORTER_OTLP_ENDPOINT') ?: 'http://localhost:4318';
$serviceName = getenv('OTEL_SERVICE_NAME') ?: 'my-service';

// Create resource
$resource = ResourceInfoFactory::emptyResource()->merge(
    ResourceInfo::create(Attributes::create([
        ResourceAttributes::SERVICE_NAME => $serviceName,
        ResourceAttributes::TELEMETRY_SDK_LANGUAGE => 'php',
    ]))
);

// Create transport and exporter
$transportFactory = PsrTransportFactory::discover();
$traceTransport = $transportFactory->create(
    "$otelEndpoint/v1/traces",
    ContentTypes::JSON
);
$spanExporter = new SpanExporter($traceTransport);

// Build TracerProvider
$tracerProvider = TracerProvider::builder()
    ->addSpanProcessor(new SimpleSpanProcessor($spanExporter))
    ->setResource($resource)
    ->build();

// Register globally with auto-shutdown
Sdk::builder()
    ->setTracerProvider($tracerProvider)
    ->setAutoShutdown(true)
    ->buildAndRegisterGlobal();

// Create spans
$tracer = Globals::tracerProvider()->getTracer($serviceName);
$span = $tracer->spanBuilder('my-operation')
    ->setSpanKind(SpanKind::KIND_SERVER)
    ->startSpan();

$scope = $span->activate();
try {
    $span->setAttribute('custom.attribute', 'value');
    // Your code here
    $span->setStatus(StatusCode::STATUS_OK);
} catch (Throwable $e) {
    $span->setStatus(StatusCode::STATUS_ERROR, $e->getMessage());
    $span->recordException($e);
    throw $e;
} finally {
    $span->end();
    $scope->detach();
}
```

### Logs (SDK)

```php
use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Logs\LogRecord;
use OpenTelemetry\Contrib\Otlp\LogsExporter;
use OpenTelemetry\Contrib\Otlp\ContentTypes;
use OpenTelemetry\SDK\Common\Export\Http\PsrTransportFactory;
use OpenTelemetry\SDK\Logs\LoggerProvider;
use OpenTelemetry\SDK\Logs\Processor\SimpleLogRecordProcessor;

$otelEndpoint = getenv('OTEL_EXPORTER_OTLP_ENDPOINT') ?: 'http://localhost:4318';
$serviceName = getenv('OTEL_SERVICE_NAME') ?: 'my-service';

// Create transport and exporter
$transportFactory = PsrTransportFactory::discover();
$logsTransport = $transportFactory->create(
    "$otelEndpoint/v1/logs",
    ContentTypes::JSON
);
$logsExporter = new LogsExporter($logsTransport);

// Build LoggerProvider
$loggerProvider = LoggerProvider::builder()
    ->setResource($resource)  // Use same resource as traces
    ->addLogRecordProcessor(new SimpleLogRecordProcessor($logsExporter))
    ->build();

// Register with SDK builder
Sdk::builder()
    ->setLoggerProvider($loggerProvider)
    ->buildAndRegisterGlobal();

// Emit logs
$logger = Globals::loggerProvider()->getLogger($serviceName);
$logger->emit(
    (new LogRecord('User logged in'))
        ->setSeverityText('INFO')
        ->setAttributes(['user.id' => '123'])
);
```

### Metrics (SDK)

```php
use OpenTelemetry\API\Globals;
use OpenTelemetry\Contrib\Otlp\MetricExporter;
use OpenTelemetry\Contrib\Otlp\ContentTypes;
use OpenTelemetry\SDK\Common\Export\Http\PsrTransportFactory;
use OpenTelemetry\SDK\Metrics\MeterProvider;
use OpenTelemetry\SDK\Metrics\MetricReader\ExportingReader;

$otelEndpoint = getenv('OTEL_EXPORTER_OTLP_ENDPOINT') ?: 'http://localhost:4318';
$serviceName = getenv('OTEL_SERVICE_NAME') ?: 'my-service';

// Create transport and exporter
$transportFactory = PsrTransportFactory::discover();
$metricsTransport = $transportFactory->create(
    "$otelEndpoint/v1/metrics",
    ContentTypes::JSON
);
$metricExporter = new MetricExporter($metricsTransport);
$metricReader = new ExportingReader($metricExporter);

// Build MeterProvider
$meterProvider = MeterProvider::builder()
    ->setResource($resource)  // Use same resource as traces
    ->addReader($metricReader)
    ->build();

// Register with SDK builder
Sdk::builder()
    ->setMeterProvider($meterProvider)
    ->buildAndRegisterGlobal();

// Create and use metrics
$meter = Globals::meterProvider()->getMeter($serviceName);
$counter = $meter->createCounter(
    'http.requests',
    '1',
    'Number of HTTP requests'
);

$counter->add(1, ['endpoint' => '/api/users']);
```

### Important Notes

1. **PSR-18 HTTP Client**: The SDK requires a PSR-18 compatible HTTP client. Use `php-http/guzzle7-adapter` with Guzzle 7.

2. **Content Type**: Use `ContentTypes::JSON` for OTLP HTTP JSON export. Protobuf is also supported but JSON is more compatible.

3. **Auto-Shutdown**: Always use `setAutoShutdown(true)` to ensure exporters flush on script termination.

4. **Span Context**: Logs emitted within an active span scope automatically include TraceId and SpanId for correlation.

5. **Output Buffering**: When using PHP's built-in server, use `ob_start()`/`ob_end_clean()` to prevent SDK initialization from interfering with HTTP responses.

### Running

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=my-php-service
php -S localhost:3001 index.php
```

### Reference

[OpenTelemetry PHP](https://opentelemetry.io/docs/languages/php/)
