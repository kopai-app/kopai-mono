| title                | impact | tags                                   |
| -------------------- | ------ | -------------------------------------- |
| Java Instrumentation | HIGH   | lang, java, jvm, traces, logs, metrics |

# Java Instrumentation

Set up OpenTelemetry for Java applications using the Java agent for automatic instrumentation.

## Install

```bash
# Download the latest OpenTelemetry Java agent
curl -L -O https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar
```

## Configuration

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf   # required — the agent defaults to gRPC
export OTEL_SERVICE_NAME="my-java-service"
export OTEL_LOGS_EXPORTER="otlp"
export OTEL_RESOURCE_ATTRIBUTES="validation.run_id=$RUN_ID"
```

**Environment Variables:**
| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (e.g., `http://localhost:4318`) |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | **`http/protobuf`** — Kopai is HTTP-only; the agent defaults to gRPC on 4317 |
| `OTEL_SERVICE_NAME` | Service name shown in observability backend |
| `OTEL_LOGS_EXPORTER` | Set to `otlp` to export logs via OTLP |
| `OTEL_RESOURCE_ATTRIBUTES` | Run tag for the validation loop — see `setup-environment.md` |

Forgetting the protocol is the single most common Java setup failure: the agent tries
gRPC on 4317, Kopai isn't listening there, and nothing arrives with no obvious error.

## Run with Agent

```bash
# Compile your application
javac MyApp.java

# Run with the agent attached
java -javaagent:opentelemetry-javaagent.jar MyApp
```

Or with a JAR file:

```bash
java -javaagent:opentelemetry-javaagent.jar -jar myapp.jar
```

## What Gets Instrumented

The Java agent automatically instruments:

- **Traces**: HTTP requests, database calls, messaging systems
- **Logs**: Bridges `java.util.logging`, Log4j, SLF4J to OTLP
- **Metrics**: JVM metrics, HTTP request metrics

No code changes required - the agent intercepts calls at runtime.

The agent handles flushing on JVM shutdown, so `validate-shutdown.md` S1 normally passes
without extra work. It does **not** survive `kill -9`.

## Custom spans and attributes

The agent gives you the skeleton; business context is still yours to add.

```java
import io.opentelemetry.api.trace.Span;

Span span = Span.current();
span.setAttribute("user.id", userId);
span.setAttribute("user.type", user.getTier());
span.setAttribute("cart.total", cart.getTotal());
```

```java
Tracer tracer = GlobalOpenTelemetry.getTracer("checkout-service");
Span span = tracer.spanBuilder("process-payment").startSpan();
try (Scope scope = span.makeCurrent()) {
    // ...
} catch (Exception e) {
    span.setAttribute("exception.slug", "err-stripe-charge-failed");
    span.setAttribute("error", true);
    span.recordException(e);
    span.setStatus(StatusCode.ERROR, e.getMessage());
    throw e;
} finally {
    span.end();
}
```

## Context across thread pools

Thread-local context does not follow work submitted to an executor — spans created in the
worker become **orphans**. Wrap the executor:

```java
import io.opentelemetry.context.Context;

ExecutorService traced = Context.taskWrapping(executor);
traced.submit(() -> processItem(item));   // context follows
```

The same applies to `CompletableFuture` chains and reactive streams. See
`context-propagation.md`.

## Example

See the complete working example: [kopai-integration-examples/java](https://github.com/kopai-app/kopai-integration-examples/tree/main/java)

## Reference

[OpenTelemetry Java](https://opentelemetry.io/docs/languages/java/)

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
