| title                  | impact | tags         |
| ---------------------- | ------ | ------------ |
| Python Instrumentation | HIGH   | lang, python |

## Python Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for Python applications.

### Install

```bash
pip install opentelemetry-distro opentelemetry-exporter-otlp
opentelemetry-bootstrap -a install
```

### Example

```bash
opentelemetry-instrument python app.py
```

### Manual Setup

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

provider = TracerProvider()
processor = BatchSpanProcessor(OTLPSpanExporter())
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)
```

### Reference

https://opentelemetry.io/docs/languages/python/
