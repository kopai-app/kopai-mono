import {
  dataFilterSchemas,
  denormalizedSignals,
  dashboardDatasource,
  kopaiQuery,
  kopaiQueryCompiler,
} from "@kopai/core";
import z from "zod";
import { request } from "./request.js";
import { paginate } from "./pagination.js";
import type {
  KopaiClientOptions,
  RequestOptions,
  SearchResult,
  TracesDataFilter,
  LogsDataFilter,
  MetricsDataFilter,
  OtelTracesRow,
  OtelLogsRow,
  OtelMetricsRow,
  AggregatedMetricRow,
  MetricsDiscoveryResult,
  Dashboard,
  CreateDashboardParams,
  SearchDashboardsFilter,
  TraceSummariesFilter,
  TraceSummaryRow,
} from "./types.js";

const DEFAULT_TIMEOUT = 30_000;

// Response schemas
const tracesResponseSchema = z.object({
  data: z.array(denormalizedSignals.otelTracesSchema),
  nextCursor: z.string().nullable(),
});

const logsResponseSchema = z.object({
  data: z.array(denormalizedSignals.otelLogsSchema),
  nextCursor: z.string().nullable(),
});

const metricsResponseSchema = z.object({
  data: z.array(denormalizedSignals.otelMetricsSchema),
  nextCursor: z.string().nullable(),
});

const aggregatedMetricsResponseSchema = z.object({
  data: z.array(denormalizedSignals.aggregatedMetricSchema),
  nextCursor: z.null(),
});

// KopaiQuery aggregate-row response: dynamic dimension/measure keys.
const aggregateResponseSchema = z.object({
  data: z.array(
    z.record(z.string(), z.union([z.string(), z.number(), z.null()]))
  ),
});

// Aggregate result shape keyed off the query's `output.type`: timeSeries rows
// carry an extra `bucket_start` ISO string. Mirrors core's KopaiQueryResult so
// the narrow query*Aggregate methods stay consistent with query().
type AggregateResultFor<Q extends { output: { type: string } }> = Q extends {
  output: { type: "timeSeries" };
}
  ? { data: (kopaiQuery.KopaiAggregateRow & { bucket_start: string })[] }
  : { data: kopaiQuery.KopaiAggregateRow[] };

// Concrete union of every result shape `query()` can return. Use this when
// consuming a query response without a statically-known query type (the
// generic `KopaiQueryResult<Q>` requires the specific Q). Re-exported from the
// package root.
export type KopaiQueryResponse = kopaiQuery.KopaiQueryResponse;

const dashboardResponseSchema = dashboardDatasource.dashboardSchema;

const dashboardSearchResponseSchema = z.object({
  data: z.array(dashboardDatasource.dashboardSchema),
  nextCursor: z.string().nullable(),
});

const servicesResponseSchema = z.object({
  services: z.array(z.string()),
});

const operationsResponseSchema = z.object({
  operations: z.array(z.string()),
});

const traceSummariesResponseSchema = z.object({
  data: z.array(dataFilterSchemas.traceSummaryRowSchema),
  nextCursor: z.string().nullable(),
});

const metricsDiscoverySchema = z.object({
  metrics: z.array(
    z.object({
      name: z.string(),
      type: z.enum([
        "Gauge",
        "Sum",
        "Histogram",
        "ExponentialHistogram",
        "Summary",
      ]),
      unit: z.string().optional(),
      description: z.string().optional(),
      attributes: z.object({
        values: z.record(z.string(), z.array(z.string())),
        _truncated: z.boolean().optional(),
      }),
      resourceAttributes: z.object({
        values: z.record(z.string(), z.array(z.string())),
        _truncated: z.boolean().optional(),
      }),
    })
  ),
});

export class KopaiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly defaultTimeout: number;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: KopaiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.fetchFn = options.fetch ?? fetch;
    this.defaultTimeout = options.timeout ?? DEFAULT_TIMEOUT;

    this.baseHeaders = {
      ...options.headers,
    };

    if (options.token) {
      this.baseHeaders["Authorization"] = `Bearer ${options.token}`;
    }
  }

  /**
   * Get all spans for a specific trace by ID.
   */
  async getTrace(
    traceId: string,
    opts?: RequestOptions
  ): Promise<OtelTracesRow[]> {
    const schema = z.array(denormalizedSignals.otelTracesSchema);
    return request(`${this.baseUrl}/signals/traces/${traceId}`, schema, {
      method: "GET",
      ...opts,
      baseHeaders: this.baseHeaders,
      fetchFn: this.fetchFn,
      defaultTimeout: this.defaultTimeout,
    });
  }

  /**
   * Search traces with auto-pagination.
   * Yields individual trace rows.
   */
  searchTraces(
    filter: Omit<TracesDataFilter, "cursor">,
    opts?: RequestOptions
  ): AsyncIterable<OtelTracesRow> {
    return paginate(
      (cursor, signal) =>
        this.searchTracesPage({ ...filter, cursor }, { ...opts, signal }),
      opts?.signal
    );
  }

  /**
   * Search traces for a single page.
   * Use this for manual pagination.
   */
  async searchTracesPage(
    filter: TracesDataFilter,
    opts?: RequestOptions
  ): Promise<SearchResult<OtelTracesRow>> {
    // Validate filter
    const validatedFilter =
      dataFilterSchemas.tracesDataFilterSchema.parse(filter);

    return request(
      `${this.baseUrl}/signals/traces/search`,
      tracesResponseSchema,
      {
        method: "POST",
        body: validatedFilter,
        ...opts,
        baseHeaders: this.baseHeaders,
        fetchFn: this.fetchFn,
        defaultTimeout: this.defaultTimeout,
      }
    );
  }

  /**
   * Search logs with auto-pagination.
   * Yields individual log rows.
   */
  searchLogs(
    filter: Omit<LogsDataFilter, "cursor">,
    opts?: RequestOptions
  ): AsyncIterable<OtelLogsRow> {
    return paginate(
      (cursor, signal) =>
        this.searchLogsPage({ ...filter, cursor }, { ...opts, signal }),
      opts?.signal
    );
  }

  /**
   * Search logs for a single page.
   * Use this for manual pagination.
   */
  async searchLogsPage(
    filter: LogsDataFilter,
    opts?: RequestOptions
  ): Promise<SearchResult<OtelLogsRow>> {
    // Validate filter
    const validatedFilter =
      dataFilterSchemas.logsDataFilterSchema.parse(filter);

    return request(`${this.baseUrl}/signals/logs/search`, logsResponseSchema, {
      method: "POST",
      body: validatedFilter,
      ...opts,
      baseHeaders: this.baseHeaders,
      fetchFn: this.fetchFn,
      defaultTimeout: this.defaultTimeout,
    });
  }

  /**
   * Search metrics with auto-pagination.
   * Yields individual metric rows.
   */
  searchMetrics(
    filter: Omit<MetricsDataFilter, "cursor">,
    opts?: RequestOptions
  ): AsyncIterable<OtelMetricsRow> {
    return paginate(
      (cursor, signal) =>
        this.searchMetricsPage({ ...filter, cursor }, { ...opts, signal }),
      opts?.signal
    );
  }

  /**
   * Search metrics for a single page.
   * Use this for manual pagination.
   */
  async searchMetricsPage(
    filter: MetricsDataFilter,
    opts?: RequestOptions
  ): Promise<SearchResult<OtelMetricsRow>> {
    // Validate filter
    const validatedFilter =
      dataFilterSchemas.metricsDataFilterSchema.parse(filter);

    return request(
      `${this.baseUrl}/signals/metrics/search`,
      metricsResponseSchema,
      {
        method: "POST",
        body: validatedFilter,
        ...opts,
        baseHeaders: this.baseHeaders,
        fetchFn: this.fetchFn,
        defaultTimeout: this.defaultTimeout,
      }
    );
  }

  /**
   * Search aggregated metrics (requires aggregate in filter).
   * Returns grouped/aggregated values instead of raw data points.
   */
  async searchAggregatedMetrics(
    filter: MetricsDataFilter & {
      aggregate: NonNullable<MetricsDataFilter["aggregate"]>;
    },
    opts?: RequestOptions
  ): Promise<{ data: AggregatedMetricRow[]; nextCursor: null }> {
    const validatedFilter =
      dataFilterSchemas.metricsDataFilterSchema.parse(filter);

    return request(
      `${this.baseUrl}/signals/metrics/search`,
      aggregatedMetricsResponseSchema,
      {
        method: "POST",
        body: validatedFilter,
        ...opts,
        baseHeaders: this.baseHeaders,
        fetchFn: this.fetchFn,
        defaultTimeout: this.defaultTimeout,
      }
    );
  }

  /**
   * Discover available metrics and their attributes.
   */
  async discoverMetrics(
    opts?: RequestOptions
  ): Promise<MetricsDiscoveryResult> {
    return request(
      `${this.baseUrl}/signals/metrics/discover`,
      metricsDiscoverySchema,
      {
        method: "GET",
        ...opts,
        baseHeaders: this.baseHeaders,
        fetchFn: this.fetchFn,
        defaultTimeout: this.defaultTimeout,
      }
    );
  }

  /**
   * Get a dashboard by ID.
   */
  async getDashboard(id: string, opts?: RequestOptions): Promise<Dashboard> {
    return request(
      `${this.baseUrl}/dashboards/${id}`,
      dashboardResponseSchema,
      {
        method: "GET",
        ...opts,
        baseHeaders: this.baseHeaders,
        fetchFn: this.fetchFn,
        defaultTimeout: this.defaultTimeout,
      }
    );
  }

  /**
   * Search dashboards for a single page.
   */
  async searchDashboardsPage(
    filter: SearchDashboardsFilter,
    opts?: RequestOptions
  ): Promise<SearchResult<Dashboard>> {
    const validatedFilter =
      dashboardDatasource.searchDashboardsFilter.parse(filter);

    return request(
      `${this.baseUrl}/dashboards/search`,
      dashboardSearchResponseSchema,
      {
        method: "POST",
        body: validatedFilter,
        ...opts,
        baseHeaders: this.baseHeaders,
        fetchFn: this.fetchFn,
        defaultTimeout: this.defaultTimeout,
      }
    );
  }

  /**
   * Search dashboards with auto-pagination.
   */
  searchDashboards(
    filter: Omit<SearchDashboardsFilter, "cursor">,
    opts?: RequestOptions
  ): AsyncIterable<Dashboard> {
    return paginate(
      (cursor, signal) =>
        this.searchDashboardsPage({ ...filter, cursor }, { ...opts, signal }),
      opts?.signal
    );
  }

  /**
   * Create a new dashboard.
   */
  async createDashboard(
    params: CreateDashboardParams,
    opts?: RequestOptions
  ): Promise<Dashboard> {
    return request(`${this.baseUrl}/dashboards`, dashboardResponseSchema, {
      method: "POST",
      body: params,
      ...opts,
      baseHeaders: this.baseHeaders,
      fetchFn: this.fetchFn,
      defaultTimeout: this.defaultTimeout,
    });
  }

  /**
   * List distinct service names.
   */
  async getServices(opts?: RequestOptions): Promise<{ services: string[] }> {
    return request(`${this.baseUrl}/signals/services`, servicesResponseSchema, {
      method: "GET",
      ...opts,
      baseHeaders: this.baseHeaders,
      fetchFn: this.fetchFn,
      defaultTimeout: this.defaultTimeout,
    });
  }

  /**
   * List distinct operations for a service.
   */
  async getOperations(
    serviceName: string,
    opts?: RequestOptions
  ): Promise<{ operations: string[] }> {
    const params = new URLSearchParams({ serviceName });
    return request(
      `${this.baseUrl}/signals/traces/operations?${params}`,
      operationsResponseSchema,
      {
        method: "GET",
        ...opts,
        baseHeaders: this.baseHeaders,
        fetchFn: this.fetchFn,
        defaultTimeout: this.defaultTimeout,
      }
    );
  }

  /**
   * Search trace summaries for a single page.
   */
  async searchTraceSummariesPage(
    filter: TraceSummariesFilter,
    opts?: RequestOptions
  ): Promise<SearchResult<TraceSummaryRow>> {
    const validatedFilter =
      dataFilterSchemas.traceSummariesFilterSchema.parse(filter);
    return request(
      `${this.baseUrl}/signals/traces/summaries`,
      traceSummariesResponseSchema,
      {
        method: "POST",
        body: validatedFilter,
        ...opts,
        baseHeaders: this.baseHeaders,
        fetchFn: this.fetchFn,
        defaultTimeout: this.defaultTimeout,
      }
    );
  }

  /**
   * Run a raw trace query (KopaiQuery). Returns denormalized span rows.
   */
  async queryTracesRaw(
    q: kopaiQuery.TraceRawQuery,
    opts?: RequestOptions
  ): Promise<SearchResult<OtelTracesRow>> {
    const validated = kopaiQuery.TraceRawQuerySchema.parse(q);
    kopaiQueryCompiler.validateKopaiQuery(validated);
    return request(
      `${this.baseUrl}/signals/query/traces/raw`,
      tracesResponseSchema,
      {
        method: "POST",
        body: validated,
        ...opts,
        baseHeaders: this.baseHeaders,
        fetchFn: this.fetchFn,
        defaultTimeout: this.defaultTimeout,
      }
    );
  }

  /**
   * Run an aggregate trace query (KopaiQuery). Returns grouped rows.
   */
  async queryTracesAggregate<Q extends kopaiQuery.TraceAggregateQuery>(
    q: Q,
    opts?: RequestOptions
  ): Promise<AggregateResultFor<Q>> {
    const validated = kopaiQuery.TraceAggregateQuerySchema.parse(q);
    kopaiQueryCompiler.validateKopaiQuery(validated);
    const res = await request(
      `${this.baseUrl}/signals/query/traces/aggregate`,
      aggregateResponseSchema,
      {
        method: "POST",
        body: validated,
        ...opts,
        baseHeaders: this.baseHeaders,
        fetchFn: this.fetchFn,
        defaultTimeout: this.defaultTimeout,
      }
    );
    return res as AggregateResultFor<Q>;
  }

  /**
   * Run a raw log query (KopaiQuery). Returns denormalized log rows.
   */
  async queryLogsRaw(
    q: kopaiQuery.LogRawQuery,
    opts?: RequestOptions
  ): Promise<SearchResult<OtelLogsRow>> {
    const validated = kopaiQuery.LogRawQuerySchema.parse(q);
    kopaiQueryCompiler.validateKopaiQuery(validated);
    return request(
      `${this.baseUrl}/signals/query/logs/raw`,
      logsResponseSchema,
      {
        method: "POST",
        body: validated,
        ...opts,
        baseHeaders: this.baseHeaders,
        fetchFn: this.fetchFn,
        defaultTimeout: this.defaultTimeout,
      }
    );
  }

  /**
   * Run an aggregate log query (KopaiQuery). Returns grouped rows.
   */
  async queryLogsAggregate<Q extends kopaiQuery.LogAggregateQuery>(
    q: Q,
    opts?: RequestOptions
  ): Promise<AggregateResultFor<Q>> {
    const validated = kopaiQuery.LogAggregateQuerySchema.parse(q);
    kopaiQueryCompiler.validateKopaiQuery(validated);
    const res = await request(
      `${this.baseUrl}/signals/query/logs/aggregate`,
      aggregateResponseSchema,
      {
        method: "POST",
        body: validated,
        ...opts,
        baseHeaders: this.baseHeaders,
        fetchFn: this.fetchFn,
        defaultTimeout: this.defaultTimeout,
      }
    );
    return res as AggregateResultFor<Q>;
  }

  /**
   * Run a raw metric query (KopaiQuery). Returns denormalized data-point rows.
   */
  async queryMetricsRaw(
    q: kopaiQuery.MetricRawQuery,
    opts?: RequestOptions
  ): Promise<SearchResult<OtelMetricsRow>> {
    const validated = kopaiQuery.MetricRawQuerySchema.parse(q);
    kopaiQueryCompiler.validateKopaiQuery(validated);
    return request(
      `${this.baseUrl}/signals/query/metrics/raw`,
      metricsResponseSchema,
      {
        method: "POST",
        body: validated,
        ...opts,
        baseHeaders: this.baseHeaders,
        fetchFn: this.fetchFn,
        defaultTimeout: this.defaultTimeout,
      }
    );
  }

  /**
   * Run an aggregate metric query (KopaiQuery). Returns grouped rows.
   */
  async queryMetricsAggregate<Q extends kopaiQuery.MetricAggregateQuery>(
    q: Q,
    opts?: RequestOptions
  ): Promise<AggregateResultFor<Q>> {
    const validated = kopaiQuery.MetricAggregateQuerySchema.parse(q);
    kopaiQueryCompiler.validateKopaiQuery(validated);
    const res = await request(
      `${this.baseUrl}/signals/query/metrics/aggregate`,
      aggregateResponseSchema,
      {
        method: "POST",
        body: validated,
        ...opts,
        baseHeaders: this.baseHeaders,
        fetchFn: this.fetchFn,
        defaultTimeout: this.defaultTimeout,
      }
    );
    return res as AggregateResultFor<Q>;
  }

  /**
   * Polymorphic query dispatcher. Given any KopaiQuery, picks the matching
   * narrow method by (signal, mode). Builder output (kq.traces.aggregate()
   * ...build()) can be passed directly without choosing a method name.
   */
  async query<Q extends kopaiQuery.KopaiQuery>(
    q: Q,
    opts?: RequestOptions
  ): Promise<kopaiQuery.KopaiQueryResult<Q>> {
    // Dispatch on (signal, mode) to one of the six narrow methods. Each
    // narrow method returns a concrete shape; the conditional
    // `KopaiQueryResult<Q>` can't be proven through this dispatch tree,
    // so a single cast bridges the concrete union to the conditional
    // return type. Same justification as the sqlite/clickhouse datasource
    // dispatchers.
    let result:
      | { data: OtelTracesRow[]; nextCursor: string | null }
      | { data: OtelLogsRow[]; nextCursor: string | null }
      | { data: OtelMetricsRow[]; nextCursor: string | null }
      | { data: kopaiQuery.KopaiAggregateRow[] };
    if (q.signal === "traces" && q.mode === "raw") {
      result = await this.queryTracesRaw(q, opts);
    } else if (q.signal === "traces") {
      result = await this.queryTracesAggregate(q, opts);
    } else if (q.signal === "logs" && q.mode === "raw") {
      result = await this.queryLogsRaw(q, opts);
    } else if (q.signal === "logs") {
      result = await this.queryLogsAggregate(q, opts);
    } else if (q.mode === "raw") {
      result = await this.queryMetricsRaw(q, opts);
    } else {
      result = await this.queryMetricsAggregate(q, opts);
    }
    return result as kopaiQuery.KopaiQueryResult<Q>;
  }
}
