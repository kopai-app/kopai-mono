import {
  dataFilterSchemas,
  denormalizedSignals,
  dashboardDatasource,
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
    filter: MetricsDataFilter,
    opts?: RequestOptions
  ): Promise<{ data: AggregatedMetricRow[]; nextCursor: null }> {
    const validatedFilter =
      dataFilterSchemas.metricsDataFilterSchema.parse(filter);

    if (!validatedFilter.aggregate) {
      throw new Error(
        "searchAggregatedMetrics requires aggregate to be set in filter"
      );
    }

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
}
