| title               | impact | tags      |
| ------------------- | ------ | --------- |
| PHP Instrumentation | HIGH   | lang, php |

## PHP Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for PHP applications.

### Install

```bash
composer require open-telemetry/sdk
composer require open-telemetry/exporter-otlp
```

### Example

```php
use OpenTelemetry\SDK\Trace\TracerProviderFactory;
use OpenTelemetry\Contrib\Otlp\SpanExporter;

$tracerProvider = (new TracerProviderFactory())->create();
$tracer = $tracerProvider->getTracer('my-app');
```

### Reference

https://opentelemetry.io/docs/languages/php/
