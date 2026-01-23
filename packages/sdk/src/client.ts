import { dataFilterSchemas, denormalizedSignals } from "@kopai/core";
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
  MetricsDiscoveryResult,
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
    const result: OtelTracesRow[] = [];
    for await (const span of this.searchTraces({ traceId }, opts)) {
      result.push(span);
    }
    return result;
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

    return request(`${this.baseUrl}/v1/traces`, tracesResponseSchema, {
      method: "POST",
      body: validatedFilter,
      ...opts,
      baseHeaders: this.baseHeaders,
      fetchFn: this.fetchFn,
      defaultTimeout: this.defaultTimeout,
    });
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

    return request(`${this.baseUrl}/v1/logs`, logsResponseSchema, {
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

    return request(`${this.baseUrl}/v1/metrics`, metricsResponseSchema, {
      method: "POST",
      body: validatedFilter,
      ...opts,
      baseHeaders: this.baseHeaders,
      fetchFn: this.fetchFn,
      defaultTimeout: this.defaultTimeout,
    });
  }

  /**
   * Discover available metrics and their attributes.
   */
  async discoverMetrics(
    opts?: RequestOptions
  ): Promise<MetricsDiscoveryResult> {
    return request(
      `${this.baseUrl}/v1/metrics/discover`,
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
}
