| title                  | impact | tags         |
| ---------------------- | ------ | ------------ |
| Python Instrumentation | HIGH   | lang, python |

# Python Instrumentation

Set up OpenTelemetry SDK for Python applications with traces, logs, and metrics.

## Install

```bash
pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
```

## Manual Setup (All Three Signals)

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

## Shutdown

Nothing flushes on its own. Without this, short scripts and SIGTERM'd servers lose their
last batch — see `validate-shutdown.md`.

```python
import atexit, signal, sys

def shutdown(*_):
    trace_provider.shutdown()      # flush order: traces, metrics, logs
    meter_provider.shutdown()
    logger_provider.shutdown()

atexit.register(shutdown)
signal.signal(signal.SIGTERM, lambda *_: (shutdown(), sys.exit(0)))
```

## Auto-Instrumentation (Traces Only)

```bash
pip install opentelemetry-distro
opentelemetry-bootstrap -a install
opentelemetry-instrument python app.py
```

`opentelemetry-bootstrap -a install` inspects your installed packages and pulls the
matching instrumentation libraries — Flask, Django, requests, psycopg, SQLAlchemy,
redis and so on. Re-run it after adding dependencies, or their calls stay invisible.

## Custom spans and attributes

```python
from opentelemetry import trace

tracer = trace.get_tracer("checkout-service")

# attributes on the span you already have
span = trace.get_current_span()
span.set_attribute("user.id", user.id)
span.set_attribute("user.type", user.tier)

# a span of your own
with tracer.start_as_current_span("process-payment") as span:
    span.set_attribute("payment.amount", order.total)
```

## Context across threads and processes

`contextvars` propagate through async/await and within a thread automatically. They do
**not** cross a `ThreadPoolExecutor` boundary or a `multiprocessing` fork — spans created
there become **orphans**:

```python
from opentelemetry import context as otel_context

ctx = otel_context.get_current()

def run():
    token = otel_context.attach(ctx)
    try:
        process_item(item)
    finally:
        otel_context.detach(token)

executor.submit(run)
```

See `context-propagation.md`.

## Reference

[OpenTelemetry Python](https://opentelemetry.io/docs/languages/python/)

## Next

SDK setup is step 3 of six. It gets bytes flowing; it does not make the telemetry good.

1. Decide what earns a span — `instrument-spans.md`
2. Add the context that makes spans answerable — `instrument-attributes.md`
3. Instrument the error paths — `instrument-errors.md`
4. Drive traffic yourself — `drive-traffic.md`
5. Assert on what arrived — `validate-traces.md`

Confirm before moving on: the SDK starts **before** any application code that could
create a span, and shutdown flushes on SIGTERM (`validate-shutdown.md`). Both fail
silently.
