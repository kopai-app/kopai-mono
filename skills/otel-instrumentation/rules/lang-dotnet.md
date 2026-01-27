| title                | impact | tags                 |
| -------------------- | ------ | -------------------- |
| .NET Instrumentation | HIGH   | lang, dotnet, csharp |

## .NET Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for .NET applications.

### Install

```bash
dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol
dotnet add package OpenTelemetry.Extensions.Hosting
dotnet add package OpenTelemetry.Instrumentation.AspNetCore
```

### Example

```csharp
builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddOtlpExporter());
```

### Reference

[OpenTelemetry .NET](https://opentelemetry.io/docs/languages/net/)
