import type { denormalizedSignals } from "@kopai/core";

type OtelTracesRow = denormalizedSignals.OtelTracesRow;

// Shared trace ID for the main trace
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

// Span IDs (8-byte hex = 16 hex chars)
const ROOT_SPAN = "b7ad6b7169203331";
const CHILD_AUTH = "5cc999522982f714";
const CHILD_USERS = "0e0a2b1c7f4d3e5a";
const CHILD_DB = "1a2b3c4d5e6f7a8b";
const CHILD_CACHE = "9f8e7d6c5b4a3210";
const CHILD_SERIALIZE = "aa11bb22cc33dd44";
const CHILD_LOGGING = "ee55ff6600771188";
const CHILD_RESPONSE = "2233445566778899";

// Base timestamp: 2023-11-14T22:13:20Z in nanoseconds
const BASE_NS = 1700000000000000000n;
const ts = (offsetMs: number) =>
  (BASE_NS + BigInt(offsetMs) * 1000000n).toString();
const dur = (ms: number) => (BigInt(ms) * 1000000n).toString();

export const mockTraceRows: OtelTracesRow[] = [
  // Root span: api-gateway GET /api/users
  {
    SpanId: ROOT_SPAN,
    TraceId: TRACE_ID,
    Timestamp: ts(0),
    Duration: dur(320),
    ParentSpanId: "",
    ServiceName: "api-gateway",
    SpanName: "GET /api/users",
    SpanKind: "SERVER",
    StatusCode: "OK",
    StatusMessage: "",
    ScopeName: "opentelemetry.instrumentation.http",
    ScopeVersion: "0.44.0",
    SpanAttributes: {
      "http.method": "GET",
      "http.url": "https://api.example.com/api/users",
      "http.status_code": 200,
      "http.route": "/api/users",
      "net.host.name": "api.example.com",
      "net.host.port": 443,
      "http.request_content_length": 0,
      "http.response_content_length": 4096,
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
      "host.name": "api-gw-prod-01",
    },
    "Events.Name": ["request.received", "response.sent"],
    "Events.Timestamp": [ts(0), ts(319)],
    "Events.Attributes": [
      { "http.method": "GET", "client.address": "192.168.1.42" },
      { "http.status_code": 200, "response.size_bytes": 4096 },
    ],
  },

  // Child 1: auth-service AuthService.validate
  {
    SpanId: CHILD_AUTH,
    TraceId: TRACE_ID,
    Timestamp: ts(2),
    Duration: dur(35),
    ParentSpanId: ROOT_SPAN,
    ServiceName: "auth-service",
    SpanName: "AuthService.validate",
    SpanKind: "CLIENT",
    StatusCode: "OK",
    StatusMessage: "",
    ScopeName: "opentelemetry.instrumentation.grpc",
    ScopeVersion: "0.44.0",
    SpanAttributes: {
      "rpc.system": "grpc",
      "rpc.service": "AuthService",
      "rpc.method": "validate",
      "rpc.grpc.status_code": 0,
      "auth.token_type": "Bearer",
    },
    ResourceAttributes: {
      "service.name": "auth-service",
      "service.version": "2.1.0",
      "deployment.environment": "production",
      "host.name": "auth-prod-01",
    },
  },

  // Child 2: user-service UserService.getUsers
  {
    SpanId: CHILD_USERS,
    TraceId: TRACE_ID,
    Timestamp: ts(40),
    Duration: dur(250),
    ParentSpanId: ROOT_SPAN,
    ServiceName: "user-service",
    SpanName: "UserService.getUsers",
    SpanKind: "INTERNAL",
    StatusCode: "OK",
    StatusMessage: "",
    ScopeName: "opentelemetry.instrumentation.express",
    ScopeVersion: "0.44.0",
    SpanAttributes: {
      "code.function": "getUsers",
      "code.namespace": "UserService",
      "app.users.limit": 50,
      "app.users.offset": 0,
    },
    ResourceAttributes: {
      "service.name": "user-service",
      "service.version": "3.0.1",
      "deployment.environment": "production",
      "host.name": "user-svc-prod-02",
    },
  },

  // Child 2a: user-service PostgresDB.query (child of UserService.getUsers)
  {
    SpanId: CHILD_DB,
    TraceId: TRACE_ID,
    Timestamp: ts(45),
    Duration: dur(180),
    ParentSpanId: CHILD_USERS,
    ServiceName: "user-service",
    SpanName: "PostgresDB.query",
    SpanKind: "CLIENT",
    StatusCode: "OK",
    StatusMessage: "",
    ScopeName: "opentelemetry.instrumentation.pg",
    ScopeVersion: "0.44.0",
    SpanAttributes: {
      "db.system": "postgresql",
      "db.name": "users_db",
      "db.statement": "SELECT id, name, email FROM users LIMIT $1 OFFSET $2",
      "db.operation": "SELECT",
      "db.sql.table": "users",
      "net.peer.name": "pg-primary.internal",
      "net.peer.port": 5432,
    },
    ResourceAttributes: {
      "service.name": "user-service",
      "service.version": "3.0.1",
      "deployment.environment": "production",
      "host.name": "user-svc-prod-02",
    },
    "Links.TraceId": ["abcdef0123456789abcdef0123456789"],
    "Links.SpanId": ["1122334455667788"],
    "Links.TraceState": [""],
    "Links.Attributes": [{ "link.reason": "batch_parent" }],
  },

  // Child 3: cache-service Redis.get
  {
    SpanId: CHILD_CACHE,
    TraceId: TRACE_ID,
    Timestamp: ts(38),
    Duration: dur(5),
    ParentSpanId: ROOT_SPAN,
    ServiceName: "cache-service",
    SpanName: "Redis.get",
    SpanKind: "CLIENT",
    StatusCode: "OK",
    StatusMessage: "",
    ScopeName: "opentelemetry.instrumentation.redis",
    ScopeVersion: "0.44.0",
    SpanAttributes: {
      "db.system": "redis",
      "db.operation": "GET",
      "db.statement": "GET users:list:page:0",
      "net.peer.name": "redis-primary.internal",
      "net.peer.port": 6379,
      "cache.hit": false,
    },
    ResourceAttributes: {
      "service.name": "cache-service",
      "service.version": "1.0.5",
      "deployment.environment": "production",
      "host.name": "cache-prod-01",
    },
  },

  // Child 4: user-service serialize response
  {
    SpanId: CHILD_SERIALIZE,
    TraceId: TRACE_ID,
    Timestamp: ts(292),
    Duration: dur(15),
    ParentSpanId: CHILD_USERS,
    ServiceName: "user-service",
    SpanName: "UserService.serialize",
    SpanKind: "INTERNAL",
    StatusCode: "OK",
    StatusMessage: "",
    ScopeName: "opentelemetry.instrumentation.express",
    ScopeVersion: "0.44.0",
    SpanAttributes: {
      "code.function": "serialize",
      "code.namespace": "UserService",
      "app.serialization.format": "json",
      "app.records.count": 42,
    },
    ResourceAttributes: {
      "service.name": "user-service",
      "service.version": "3.0.1",
      "deployment.environment": "production",
      "host.name": "user-svc-prod-02",
    },
  },

  // Child 5: api-gateway logging middleware
  {
    SpanId: CHILD_LOGGING,
    TraceId: TRACE_ID,
    Timestamp: ts(1),
    Duration: dur(1),
    ParentSpanId: ROOT_SPAN,
    ServiceName: "api-gateway",
    SpanName: "Middleware.logging",
    SpanKind: "INTERNAL",
    StatusCode: "UNSET",
    ScopeName: "opentelemetry.instrumentation.express",
    ScopeVersion: "0.44.0",
    SpanAttributes: {
      "express.type": "middleware",
      "express.name": "loggingMiddleware",
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
      "host.name": "api-gw-prod-01",
    },
  },

  // Child 6: api-gateway response formatting
  {
    SpanId: CHILD_RESPONSE,
    TraceId: TRACE_ID,
    Timestamp: ts(310),
    Duration: dur(8),
    ParentSpanId: ROOT_SPAN,
    ServiceName: "api-gateway",
    SpanName: "Response.format",
    SpanKind: "INTERNAL",
    StatusCode: "OK",
    ScopeName: "opentelemetry.instrumentation.express",
    ScopeVersion: "0.44.0",
    SpanAttributes: {
      "http.response_content_length": 4096,
      "http.content_type": "application/json",
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
      "host.name": "api-gw-prod-01",
    },
  },
];

// ── Error trace ──

const ERROR_TRACE_ID = "1bf8762027de54ee9559fc322d91420d";
const ERR_ROOT = "c8ae7e8270314442";
const ERR_CHILD_AUTH = "d9bf8f9381425553";
const ERR_CHILD_PARSE = "eac0a0a492536664";
const ERR_CHILD_LOG = "fbd1b1b5a3647775";

const ERR_BASE_NS = 1700000010000000000n; // 10s after main trace
const ets = (offsetMs: number) =>
  (ERR_BASE_NS + BigInt(offsetMs) * 1000000n).toString();

export const mockErrorTraceRows: OtelTracesRow[] = [
  // Root span: api-gateway POST /api/users
  {
    SpanId: ERR_ROOT,
    TraceId: ERROR_TRACE_ID,
    Timestamp: ets(0),
    Duration: dur(95),
    ParentSpanId: "",
    ServiceName: "api-gateway",
    SpanName: "POST /api/users",
    SpanKind: "SERVER",
    StatusCode: "ERROR",
    StatusMessage: "Internal server error",
    ScopeName: "opentelemetry.instrumentation.http",
    ScopeVersion: "0.44.0",
    SpanAttributes: {
      "http.method": "POST",
      "http.url": "https://api.example.com/api/users",
      "http.status_code": 500,
      "http.route": "/api/users",
      "net.host.name": "api.example.com",
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
      "host.name": "api-gw-prod-01",
    },
    "Events.Name": ["exception"],
    "Events.Timestamp": [ets(90)],
    "Events.Attributes": [
      {
        "exception.type": "InternalServerError",
        "exception.message": "Failed to parse request body: invalid JSON",
        "exception.stacktrace":
          "Error: Failed to parse request body: invalid JSON\n    at parseBody (/app/src/middleware/body-parser.ts:42:11)\n    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)",
      },
    ],
  },

  // Child: auth-service validate (OK)
  {
    SpanId: ERR_CHILD_AUTH,
    TraceId: ERROR_TRACE_ID,
    Timestamp: ets(1),
    Duration: dur(30),
    ParentSpanId: ERR_ROOT,
    ServiceName: "auth-service",
    SpanName: "AuthService.validate",
    SpanKind: "CLIENT",
    StatusCode: "OK",
    StatusMessage: "",
    ScopeName: "opentelemetry.instrumentation.grpc",
    ScopeVersion: "0.44.0",
    SpanAttributes: {
      "rpc.system": "grpc",
      "rpc.service": "AuthService",
      "rpc.method": "validate",
      "rpc.grpc.status_code": 0,
    },
    ResourceAttributes: {
      "service.name": "auth-service",
      "service.version": "2.1.0",
      "deployment.environment": "production",
      "host.name": "auth-prod-01",
    },
  },

  // Child: api-gateway body parsing (ERROR)
  {
    SpanId: ERR_CHILD_PARSE,
    TraceId: ERROR_TRACE_ID,
    Timestamp: ets(35),
    Duration: dur(50),
    ParentSpanId: ERR_ROOT,
    ServiceName: "api-gateway",
    SpanName: "Middleware.bodyParser",
    SpanKind: "INTERNAL",
    StatusCode: "ERROR",
    StatusMessage: "Failed to parse request body: invalid JSON",
    ScopeName: "opentelemetry.instrumentation.express",
    ScopeVersion: "0.44.0",
    SpanAttributes: {
      "express.type": "middleware",
      "express.name": "bodyParser",
      "http.request_content_length": 156,
      "http.content_type": "application/json",
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
      "host.name": "api-gw-prod-01",
    },
  },

  // Child: api-gateway error logging
  {
    SpanId: ERR_CHILD_LOG,
    TraceId: ERROR_TRACE_ID,
    Timestamp: ets(86),
    Duration: dur(3),
    ParentSpanId: ERR_ROOT,
    ServiceName: "api-gateway",
    SpanName: "ErrorHandler.log",
    SpanKind: "INTERNAL",
    StatusCode: "UNSET",
    ScopeName: "opentelemetry.instrumentation.express",
    ScopeVersion: "0.44.0",
    SpanAttributes: {
      "error.logged": true,
      "error.type": "InternalServerError",
    },
    ResourceAttributes: {
      "service.name": "api-gateway",
      "service.version": "1.4.2",
      "deployment.environment": "production",
      "host.name": "api-gw-prod-01",
    },
  },
];
