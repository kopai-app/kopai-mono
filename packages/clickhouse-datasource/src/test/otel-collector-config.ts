import { CH_DATABASE, CH_USERNAME, CH_PASSWORD } from "./constants.js";

export function createOtelCollectorConfig(): string {
  return `extensions:
  health_check:
    endpoint: 0.0.0.0:13133
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
processors:
  batch:
    timeout: 1s
    send_batch_size: 10
exporters:
  clickhouse:
    endpoint: tcp://clickhouse:9000
    database: ${CH_DATABASE}
    username: ${CH_USERNAME}
    password: "${CH_PASSWORD}"
    ttl: 720h
    create_schema: true
    timeout: 10s
service:
  extensions: [health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [clickhouse]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [clickhouse]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [clickhouse]
`;
}
