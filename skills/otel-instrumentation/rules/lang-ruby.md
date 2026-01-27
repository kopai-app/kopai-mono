| title                | impact | tags       |
| -------------------- | ------ | ---------- |
| Ruby Instrumentation | HIGH   | lang, ruby |

## Ruby Instrumentation

**Impact:** HIGH

Set up OpenTelemetry SDK for Ruby applications.

### Install

```bash
gem install opentelemetry-sdk
gem install opentelemetry-exporter-otlp
gem install opentelemetry-instrumentation-all
```

### Example

```ruby
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'
require 'opentelemetry/instrumentation/all'

OpenTelemetry::SDK.configure do |c|
  c.use_all
end
```

### Reference

https://opentelemetry.io/docs/languages/ruby/
