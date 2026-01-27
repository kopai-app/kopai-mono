| title                | impact | tags            |
| -------------------- | ------ | --------------- |
| Java Instrumentation | HIGH   | lang, java, jvm |

## Java Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for Java applications.

### Agent (Recommended)

```bash
# Download agent
curl -L -O https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar

# Run with agent
java -javaagent:opentelemetry-javaagent.jar -jar myapp.jar
```

### Maven

```xml
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-api</artifactId>
</dependency>
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-sdk</artifactId>
</dependency>
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-exporter-otlp</artifactId>
</dependency>
```

### Reference

https://opentelemetry.io/docs/languages/java/
