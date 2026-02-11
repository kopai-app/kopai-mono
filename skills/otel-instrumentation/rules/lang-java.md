| title                | impact | tags                                   |
| -------------------- | ------ | -------------------------------------- |
| Java Instrumentation | HIGH   | lang, java, jvm, traces, logs, metrics |

## Java Instrumentation

**Impact:** HIGH

Set up OpenTelemetry for Java applications using the Java agent for automatic instrumentation.

### Install

```bash
# Download the latest OpenTelemetry Java agent
curl -L -O https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar
```

### Configuration

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
export OTEL_SERVICE_NAME="my-java-service"
export OTEL_LOGS_EXPORTER="otlp"
```

**Environment Variables:**
| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (e.g., `http://localhost:4318`) |
| `OTEL_SERVICE_NAME` | Service name shown in observability backend |
| `OTEL_LOGS_EXPORTER` | Set to `otlp` to export logs via OTLP |

### Run with Agent

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

### What Gets Instrumented

The Java agent automatically instruments:

- **Traces**: HTTP requests, database calls, messaging systems
- **Logs**: Bridges `java.util.logging`, Log4j, SLF4J to OTLP
- **Metrics**: JVM metrics, HTTP request metrics

No code changes required - the agent intercepts calls at runtime.

### Example

See the complete working example: [kopai-integration-examples/java](https://github.com/kopai-app/kopai-integration-examples/tree/main/java)

### Reference

[OpenTelemetry Java](https://opentelemetry.io/docs/languages/java/)
