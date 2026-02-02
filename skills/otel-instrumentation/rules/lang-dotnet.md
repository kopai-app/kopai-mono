| title                | impact | tags                              |
| -------------------- | ------ | --------------------------------- |
| .NET Instrumentation | HIGH   | lang, dotnet, csharp, traces, logs, metrics |

## .NET Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for .NET applications with traces, logs, and metrics.

### Install

```bash
dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol
dotnet add package OpenTelemetry.Extensions.Hosting
dotnet add package OpenTelemetry.Instrumentation.AspNetCore
```

### Configuration

**CRITICAL:** The OTLP exporter defaults to gRPC. For HTTP endpoints (port 4318), you MUST set `OtlpExportProtocol.HttpProtobuf` and append signal paths.

```csharp
using OpenTelemetry.Exporter;

// Get endpoint from environment
var endpoint = Environment.GetEnvironmentVariable("OTEL_EXPORTER_OTLP_ENDPOINT")
    ?? "http://localhost:4318";
var serviceName = Environment.GetEnvironmentVariable("OTEL_SERVICE_NAME")
    ?? "my-service";
```

**Environment Variables:**
| Variable | Description |
|----------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (e.g., `http://localhost:4318`) |
| `OTEL_SERVICE_NAME` | Service name shown in observability backend |

### Traces

```csharp
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService(serviceName))
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddOtlpExporter(opts =>
        {
            opts.Endpoint = new Uri($"{endpoint}/v1/traces");
            opts.Protocol = OtlpExportProtocol.HttpProtobuf;
        }));
```

### Logs

```csharp
using OpenTelemetry.Resources;

var resourceBuilder = ResourceBuilder.CreateDefault()
    .AddService(serviceName);

builder.Logging.AddOpenTelemetry(logging =>
{
    logging.SetResourceBuilder(resourceBuilder);
    logging.AddOtlpExporter(opts =>
    {
        opts.Endpoint = new Uri($"{endpoint}/v1/logs");
        opts.Protocol = OtlpExportProtocol.HttpProtobuf;
    });
});
```

### Metrics

```csharp
using System.Diagnostics.Metrics;

var meter = new Meter(serviceName);
var requestCounter = meter.CreateCounter<long>("requests", "1", "Request count");

builder.Services.AddOpenTelemetry()
    .WithMetrics(metrics => metrics
        .AddAspNetCoreInstrumentation()
        .AddMeter(serviceName)
        .AddOtlpExporter(opts =>
        {
            opts.Endpoint = new Uri($"{endpoint}/v1/metrics");
            opts.Protocol = OtlpExportProtocol.HttpProtobuf;
        }));
```

### Complete Example

```csharp
using System.Diagnostics.Metrics;
using OpenTelemetry.Exporter;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

var builder = WebApplication.CreateBuilder(args);

var endpoint = Environment.GetEnvironmentVariable("OTEL_EXPORTER_OTLP_ENDPOINT")
    ?? "http://localhost:4318";
var serviceName = Environment.GetEnvironmentVariable("OTEL_SERVICE_NAME")
    ?? "my-service";

var meter = new Meter(serviceName);
var requestCounter = meter.CreateCounter<long>("requests");

var resourceBuilder = ResourceBuilder.CreateDefault().AddService(serviceName);

// Traces and Metrics
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService(serviceName))
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddOtlpExporter(opts =>
        {
            opts.Endpoint = new Uri($"{endpoint}/v1/traces");
            opts.Protocol = OtlpExportProtocol.HttpProtobuf;
        }))
    .WithMetrics(metrics => metrics
        .AddAspNetCoreInstrumentation()
        .AddMeter(serviceName)
        .AddOtlpExporter(opts =>
        {
            opts.Endpoint = new Uri($"{endpoint}/v1/metrics");
            opts.Protocol = OtlpExportProtocol.HttpProtobuf;
        }));

// Logs
builder.Logging.AddOpenTelemetry(logging =>
{
    logging.SetResourceBuilder(resourceBuilder);
    logging.AddOtlpExporter(opts =>
    {
        opts.Endpoint = new Uri($"{endpoint}/v1/logs");
        opts.Protocol = OtlpExportProtocol.HttpProtobuf;
    });
});

var app = builder.Build();
app.MapGet("/hello", (ILogger<Program> logger) =>
{
    requestCounter.Add(1);
    logger.LogInformation("Hello endpoint called");
    return Results.Json(new { message = "Hello!" });
});
app.Run();
```

### Reference

[OpenTelemetry .NET](https://opentelemetry.io/docs/languages/net/)
