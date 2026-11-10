# kopai/kopai-get-started

## 1.0.0

### Major Changes

- First release. The skill a coding agent runs right after `kopai setup`: it checks the connection with `kopai whoami`, hands the SDK work to otel-instrumentation in Kopai Cloud mode, launches the app through `kopai run` so the backend token is never read or printed, proves telemetry arrived with a run-tagged trace search, and reports. `kopai setup` installs it alongside the other skills.
