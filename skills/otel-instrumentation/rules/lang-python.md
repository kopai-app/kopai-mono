| title                  | impact | tags         |
| ---------------------- | ------ | ------------ |
| Python Instrumentation | HIGH   | lang, python |

## Python Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for Python applications with traces, logs, and metrics.

### Install

```bash
pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
```

### Manual Setup (All Three Signals)

```python
import os
import logging
from opentelemetry import trace, metrics
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter

# Configuration from environment
ENDPOINT = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
SERVICE_NAME = os.getenv("OTEL_SERVICE_NAME", "my-service")

# Create resource
resource = Resource.create({"service.name": SERVICE_NAME})

# Traces
trace_provider = TracerProvider(resource=resource)
trace_provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{ENDPOINT}/v1/traces"))
)
trace.set_tracer_provider(trace_provider)

# Metrics
meter_provider = MeterProvider(
    resource=resource,
    metric_readers=[PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=f"{ENDPOINT}/v1/metrics")
    )]
)
metrics.set_meter_provider(meter_provider)

# Logs
logger_provider = LoggerProvider(resource=resource)
logger_provider.add_log_record_processor(
    BatchLogRecordProcessor(OTLPLogExporter(endpoint=f"{ENDPOINT}/v1/logs"))
)
handler = LoggingHandler(logger_provider=logger_provider)
logging.getLogger().addHandler(handler)
```

### Auto-Instrumentation (Traces Only)

```bash
pip install opentelemetry-distro
opentelemetry-bootstrap -a install
opentelemetry-instrument python app.py
```

### Reference

[OpenTelemetry Python](https://opentelemetry.io/docs/languages/python/)
