import type { denormalizedSignals } from "@kopai/core";

type OtelLogsRow = denormalizedSignals.OtelLogsRow;

// Correlatable trace/span IDs (match traces fixture)
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const ROOT_SPAN = "b7ad6b7169203331";
const CHILD_AUTH = "5cc999522982f714";
const CHILD_USERS = "0e0a2b1c7f4d3e5a";
const CHILD_DB = "1a2b3c4d5e6f7a8b";

// Base timestamp, staggered over ~10 seconds
const BASE_NS = 1700000000000000000n;
const ts = (offsetMs: number) =>
  (BASE_NS + BigInt(offsetMs) * 1000000n).toString();

export const mockLogRows: OtelLogsRow[] = [
  // ── api-gateway logs ──
  {
    Timestamp: ts(0),
    Body: "Request received: GET /api/users",
    SeverityText: "INFO",
    SeverityNumber: 9,
    ServiceName: "api-gateway",
    TraceId: TRACE_ID,
    SpanId: ROOT_SPAN,
    LogAttributes: {
      "http.method": "GET",
      "http.path": "/api/users",
      "client.address": "192.168.1.42",
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
    },
    ScopeName: "com.example.api-gateway",
  },
  {
    Timestamp: ts(1),
    Body: "Logging middleware initialized",
    SeverityText: "TRACE",
    SeverityNumber: 1,
    ServiceName: "api-gateway",
    LogAttributes: { "middleware.name": "loggingMiddleware" },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
    },
    ScopeName: "com.example.api-gateway",
  },
  {
    Timestamp: ts(320),
    Body: "Response sent: 200 OK (320ms)",
    SeverityText: "INFO",
    SeverityNumber: 9,
    ServiceName: "api-gateway",
    TraceId: TRACE_ID,
    SpanId: ROOT_SPAN,
    LogAttributes: {
      "http.method": "GET",
      "http.path": "/api/users",
      "http.status_code": 200,
      "response.duration_ms": 320,
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
    },
    ScopeName: "com.example.api-gateway",
  },
  {
    Timestamp: ts(1200),
    Body: "Rate limit threshold approaching: 450/500 requests in current window",
    SeverityText: "WARN",
    SeverityNumber: 13,
    ServiceName: "api-gateway",
    LogAttributes: {
      "rate_limit.current": 450,
      "rate_limit.max": 500,
      "rate_limit.window_seconds": 60,
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
    },
    ScopeName: "com.example.api-gateway.rate-limiter",
  },
  {
    Timestamp: ts(2500),
    Body: "TLS certificate expires in 7 days",
    SeverityText: "WARN",
    SeverityNumber: 14,
    ServiceName: "api-gateway",
    LogAttributes: {
      "tls.cert.expiry_days": 7,
      "tls.cert.subject": "*.example.com",
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
    },
    ScopeName: "com.example.api-gateway.tls",
  },

  // ── auth-service logs ──
  {
    Timestamp: ts(3),
    Body: "User authenticated successfully",
    SeverityText: "INFO",
    SeverityNumber: 9,
    ServiceName: "auth-service",
    TraceId: TRACE_ID,
    SpanId: CHILD_AUTH,
    LogAttributes: {
      "auth.method": "Bearer",
      "auth.user_id": "usr_8f2k3j",
      "auth.token_valid": true,
    },
    ResourceAttributes: {
      "service.name": "auth-service",
      "service.version": "2.1.0",
      "deployment.environment": "production",
    },
    ScopeName: "com.example.auth-service",
  },
  {
    Timestamp: ts(3500),
    Body: "Token refresh issued for user usr_8f2k3j",
    SeverityText: "DEBUG",
    SeverityNumber: 5,
    ServiceName: "auth-service",
    LogAttributes: {
      "auth.user_id": "usr_8f2k3j",
      "auth.token_ttl_seconds": 3600,
    },
    ResourceAttributes: {
      "service.name": "auth-service",
      "service.version": "2.1.0",
    },
    ScopeName: "com.example.auth-service",
  },
  {
    Timestamp: ts(5000),
    Body: "Failed to validate token: signature mismatch",
    SeverityText: "ERROR",
    SeverityNumber: 17,
    ServiceName: "auth-service",
    LogAttributes: {
      "error.type": "TokenValidationError",
      "auth.method": "Bearer",
      "auth.token_prefix": "eyJhbGci...",
    },
    ResourceAttributes: {
      "service.name": "auth-service",
      "service.version": "2.1.0",
      "deployment.environment": "production",
    },
    ScopeName: "com.example.auth-service",
  },
  {
    Timestamp: ts(5200),
    Body: "Auth cache eviction: 128 expired entries removed",
    SeverityText: "DEBUG",
    SeverityNumber: 7,
    ServiceName: "auth-service",
    LogAttributes: {
      "cache.evicted_count": 128,
      "cache.remaining_count": 4096,
    },
    ResourceAttributes: {
      "service.name": "auth-service",
      "service.version": "2.1.0",
    },
    ScopeName: "com.example.auth-service.cache",
  },

  // ── user-service logs ──
  {
    Timestamp: ts(42),
    Body: "Fetching users with pagination: limit=50 offset=0",
    SeverityText: "DEBUG",
    SeverityNumber: 5,
    ServiceName: "user-service",
    TraceId: TRACE_ID,
    SpanId: CHILD_USERS,
    LogAttributes: {
      "app.users.limit": 50,
      "app.users.offset": 0,
    },
    ResourceAttributes: {
      "service.name": "user-service",
      "service.version": "3.0.1",
    },
    ScopeName: "com.example.user-service",
  },
  {
    Timestamp: ts(46),
    Body: "Database query started: SELECT users",
    SeverityText: "TRACE",
    SeverityNumber: 2,
    ServiceName: "user-service",
    TraceId: TRACE_ID,
    SpanId: CHILD_DB,
    LogAttributes: {
      "db.system": "postgresql",
      "db.operation": "SELECT",
      "db.sql.table": "users",
    },
    ResourceAttributes: {
      "service.name": "user-service",
      "service.version": "3.0.1",
    },
    ScopeName: "com.example.user-service.db",
  },
  {
    Timestamp: ts(225),
    Body: "Database query completed in 180ms, returned 42 rows",
    SeverityText: "INFO",
    SeverityNumber: 9,
    ServiceName: "user-service",
    TraceId: TRACE_ID,
    SpanId: CHILD_DB,
    LogAttributes: {
      "db.system": "postgresql",
      "db.operation": "SELECT",
      "db.duration_ms": 180,
      "db.rows_returned": 42,
    },
    ResourceAttributes: {
      "service.name": "user-service",
      "service.version": "3.0.1",
      "deployment.environment": "production",
    },
    ScopeName: "com.example.user-service.db",
  },
  {
    Timestamp: ts(4000),
    Body: "Connection pool exhausted: all 20 connections in use",
    SeverityText: "ERROR",
    SeverityNumber: 17,
    ServiceName: "user-service",
    LogAttributes: {
      "db.system": "postgresql",
      "db.pool.size": 20,
      "db.pool.active": 20,
      "db.pool.idle": 0,
      "db.pool.waiting": 5,
    },
    ResourceAttributes: {
      "service.name": "user-service",
      "service.version": "3.0.1",
      "deployment.environment": "production",
    },
    ScopeName: "com.example.user-service.db",
  },
  {
    Timestamp: ts(4100),
    Body: "Connection pool recovered: 3 connections freed",
    SeverityText: "INFO",
    SeverityNumber: 10,
    ServiceName: "user-service",
    LogAttributes: {
      "db.system": "postgresql",
      "db.pool.size": 20,
      "db.pool.active": 17,
      "db.pool.idle": 3,
    },
    ResourceAttributes: {
      "service.name": "user-service",
      "service.version": "3.0.1",
    },
    ScopeName: "com.example.user-service.db",
  },
  {
    Timestamp: ts(6000),
    Body: "Slow query detected: 2340ms for SELECT on orders table",
    SeverityText: "WARN",
    SeverityNumber: 13,
    ServiceName: "user-service",
    LogAttributes: {
      "db.system": "postgresql",
      "db.operation": "SELECT",
      "db.sql.table": "orders",
      "db.duration_ms": 2340,
      "db.slow_query_threshold_ms": 1000,
    },
    ResourceAttributes: {
      "service.name": "user-service",
      "service.version": "3.0.1",
      "deployment.environment": "production",
    },
    ScopeName: "com.example.user-service.db",
  },
  {
    Timestamp: ts(6500),
    Body: "User profile updated: usr_3m9x1p",
    SeverityText: "INFO",
    SeverityNumber: 9,
    ServiceName: "user-service",
    LogAttributes: {
      "app.user_id": "usr_3m9x1p",
      "app.fields_updated": "email,phone",
    },
    ResourceAttributes: {
      "service.name": "user-service",
      "service.version": "3.0.1",
    },
    ScopeName: "com.example.user-service",
  },
  {
    Timestamp: ts(7000),
    Body: "Failed to parse request body: invalid JSON at position 42",
    SeverityText: "ERROR",
    SeverityNumber: 18,
    ServiceName: "api-gateway",
    LogAttributes: {
      "http.method": "POST",
      "http.path": "/api/users",
      "error.type": "SyntaxError",
      "error.position": 42,
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
    },
    ScopeName: "com.example.api-gateway",
  },
  {
    Timestamp: ts(7500),
    Body: "Health check passed: all dependencies healthy",
    SeverityText: "INFO",
    SeverityNumber: 9,
    ServiceName: "api-gateway",
    LogAttributes: {
      "health.db": "ok",
      "health.cache": "ok",
      "health.auth": "ok",
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
    },
    ScopeName: "com.example.api-gateway.health",
  },
  {
    Timestamp: ts(8000),
    Body: "Graceful shutdown initiated",
    SeverityText: "WARN",
    SeverityNumber: 15,
    ServiceName: "user-service",
    LogAttributes: {
      "shutdown.reason": "SIGTERM",
      "shutdown.active_connections": 3,
    },
    ResourceAttributes: {
      "service.name": "user-service",
      "service.version": "3.0.1",
      "deployment.environment": "production",
    },
    ScopeName: "com.example.user-service",
  },
  {
    Timestamp: ts(8500),
    Body: "Unrecoverable error in event loop - process exiting",
    SeverityText: "FATAL",
    SeverityNumber: 21,
    ServiceName: "user-service",
    LogAttributes: {
      "error.type": "UnhandledRejection",
      "error.message": "ENOMEM: not enough memory",
      "process.pid": 12345,
    },
    ResourceAttributes: {
      "service.name": "user-service",
      "service.version": "3.0.1",
      "deployment.environment": "production",
    },
    ScopeName: "com.example.user-service",
  },
  {
    Timestamp: ts(9000),
    Body: "Retry attempt 3/5 for upstream service call",
    SeverityText: "WARN",
    SeverityNumber: 13,
    ServiceName: "api-gateway",
    LogAttributes: {
      "retry.attempt": 3,
      "retry.max": 5,
      "retry.backoff_ms": 800,
      "upstream.service": "user-service",
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
    },
    ScopeName: "com.example.api-gateway.retry",
  },
  {
    Timestamp: ts(9200),
    Body: "Circuit breaker opened for user-service",
    SeverityText: "ERROR",
    SeverityNumber: 17,
    ServiceName: "api-gateway",
    LogAttributes: {
      "circuit_breaker.state": "open",
      "circuit_breaker.failure_count": 10,
      "circuit_breaker.threshold": 5,
      "circuit_breaker.reset_timeout_ms": 30000,
      "upstream.service": "user-service",
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
    },
    ScopeName: "com.example.api-gateway.circuit-breaker",
  },
  {
    Timestamp: ts(9500),
    Body: "JWKS key rotation completed",
    SeverityText: "INFO",
    SeverityNumber: 10,
    ServiceName: "auth-service",
    LogAttributes: {
      "auth.jwks.kid_old": "key-2023-10",
      "auth.jwks.kid_new": "key-2023-11",
    },
    ResourceAttributes: {
      "service.name": "auth-service",
      "service.version": "2.1.0",
    },
    ScopeName: "com.example.auth-service.jwks",
  },
  {
    Timestamp: ts(9800),
    Body: "Metrics flush completed: 1247 data points exported",
    SeverityText: "DEBUG",
    SeverityNumber: 6,
    ServiceName: "api-gateway",
    LogAttributes: {
      "metrics.data_points": 1247,
      "metrics.export_duration_ms": 45,
      "metrics.destination": "otel-collector:4317",
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
    },
    ScopeName: "com.example.api-gateway.metrics",
  },
  {
    Timestamp: ts(10000),
    Body: "Request completed: GET /api/users/search?q=admin",
    SeverityText: "INFO",
    SeverityNumber: 9,
    ServiceName: "api-gateway",
    LogAttributes: {
      "http.method": "GET",
      "http.path": "/api/users/search",
      "http.query": "q=admin",
      "http.status_code": 200,
      "response.duration_ms": 89,
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
    },
    ScopeName: "com.example.api-gateway",
  },
];
