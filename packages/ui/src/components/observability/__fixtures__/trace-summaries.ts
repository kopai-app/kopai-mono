import type { TraceSummary } from "../TraceSearch/index.js";

const BASE_MS = 1700000000000; // 2023-11-14T22:13:20Z

export const mockTraceSummaries: TraceSummary[] = [
  {
    traceId: "0af7651916cd43dd8448eb211c80319c",
    rootSpanName: "GET /api/users",
    serviceName: "api-gateway",
    durationMs: 320,
    statusCode: "OK",
    timestampMs: BASE_MS,
    spanCount: 8,
    services: [
      { name: "api-gateway", count: 3, hasError: false },
      { name: "user-service", count: 3, hasError: false },
      { name: "auth-service", count: 1, hasError: false },
      { name: "cache-service", count: 1, hasError: false },
    ],
    errorCount: 0,
  },
  {
    traceId: "1bf8762027de54ee9559fc322d91420d",
    rootSpanName: "POST /api/users",
    serviceName: "api-gateway",
    durationMs: 95,
    statusCode: "ERROR",
    timestampMs: BASE_MS + 10_000,
    spanCount: 4,
    services: [
      { name: "api-gateway", count: 3, hasError: true },
      { name: "auth-service", count: 1, hasError: false },
    ],
    errorCount: 2,
  },
  {
    traceId: "2cf9873138ef65ff0660ad433ea2531e",
    rootSpanName: "GET /api/products",
    serviceName: "api-gateway",
    durationMs: 450,
    statusCode: "OK",
    timestampMs: BASE_MS + 25_000,
    spanCount: 12,
    services: [
      { name: "api-gateway", count: 2, hasError: false },
      { name: "product-service", count: 5, hasError: false },
      { name: "cache-service", count: 3, hasError: false },
      { name: "search-service", count: 2, hasError: false },
    ],
    errorCount: 0,
  },
  {
    traceId: "3da0984249fa76aa1771be544fb3642f",
    rootSpanName: "PUT /api/users/42",
    serviceName: "api-gateway",
    durationMs: 180,
    statusCode: "OK",
    timestampMs: BASE_MS + 42_000,
    spanCount: 6,
    services: [
      { name: "api-gateway", count: 2, hasError: false },
      { name: "user-service", count: 3, hasError: false },
      { name: "notification-service", count: 1, hasError: false },
    ],
    errorCount: 0,
  },
  {
    traceId: "4eb1a9535aab87bb2882cf655ac4753a",
    rootSpanName: "DELETE /api/sessions",
    serviceName: "api-gateway",
    durationMs: 45,
    statusCode: "OK",
    timestampMs: BASE_MS + 60_000,
    spanCount: 3,
    services: [
      { name: "api-gateway", count: 1, hasError: false },
      { name: "auth-service", count: 2, hasError: false },
    ],
    errorCount: 0,
  },
];
