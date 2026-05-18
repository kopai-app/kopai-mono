/**
 * Type-level + runtime tests for `client.execute`.
 *
 * The type assertions live inside an `async` IIFE wrapped in `if ((1 as
 * number) > 2)` so vitest never actually invokes `client.execute` against
 * a non-existent server. The point is for `tsc` to consume the
 * `@ts-expect-error` markers and `expectTypeOf` assertions at compile
 * time.
 */
import { describe, it, expect, expectTypeOf, vi } from "vitest";
import type {
  OtelTracesRow,
  OtelLogsRow,
  OtelMetricsRow,
  SearchResult,
  TracesDataFilter,
  LogsDataFilter,
  MetricsDataFilter,
  RequestOptions,
} from "../types.js";
import { KopaiClient } from "../client.js";
import { traces } from "../query/builder.js";
import { tracesAgg } from "../query/aggs.js";

const BASE_URL = "https://api.kopai.test";

/* ------------------------------------------------------------------ */
/* Type-level assertions for client.execute                            */
/* ------------------------------------------------------------------ */

describe("client.execute type inference", () => {
  it("compiles correctly (type-only IIFE; not actually invoked)", () => {
    if ((1 as number) > 2) {
      void (async () => {
        const client = new KopaiClient({ baseUrl: BASE_URL });

        // Non-aggregated query: cursor present
        const q1 = traces
          .select({ id: traces.traceId, name: traces.spanName })
          .toQuery();
        const r1 = await client.execute(q1);
        expectTypeOf(r1).toEqualTypeOf<{
          rows: { id: string; name: string | undefined }[];
          cursor: string | null;
        }>();

        // Aggregated query: no cursor
        const q2 = traces
          .select({ p: tracesAgg.p99(traces.duration) })
          .toQuery();
        const r2 = await client.execute(q2);
        expectTypeOf(r2).toEqualTypeOf<{ rows: { p: number }[] }>();
        // @ts-expect-error — aggregated result has no `cursor` field
        void r2.cursor;

        // AbortSignal accepted
        await client.execute(q1, { signal: new AbortController().signal });
        await client.execute(q1, { signal: undefined });
        // @ts-expect-error — signal must be AbortSignal, not string
        await client.execute(q1, { signal: "not-an-abort" });

        // Plain object without phantom fields rejected
        // @ts-expect-error — no phantom `signal`/`__row`/`__isAgg` on plain object
        await client.execute({ foo: 1 } as { foo: 1 });
      });
    }
    expect(true).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Regression: existing method signatures must not change              */
/* ------------------------------------------------------------------ */

describe("existing method signatures (regression guard)", () => {
  it("getTrace", () => {
    type Sig = typeof KopaiClient.prototype.getTrace;
    expectTypeOf<Sig>().toEqualTypeOf<
      (traceId: string, opts?: RequestOptions) => Promise<OtelTracesRow[]>
    >();
  });

  it("searchTracesPage", () => {
    type Sig = typeof KopaiClient.prototype.searchTracesPage;
    expectTypeOf<Sig>().toEqualTypeOf<
      (
        filter: TracesDataFilter,
        opts?: RequestOptions
      ) => Promise<SearchResult<OtelTracesRow>>
    >();
  });

  it("searchLogsPage", () => {
    type Sig = typeof KopaiClient.prototype.searchLogsPage;
    expectTypeOf<Sig>().toEqualTypeOf<
      (
        filter: LogsDataFilter,
        opts?: RequestOptions
      ) => Promise<SearchResult<OtelLogsRow>>
    >();
  });

  it("searchMetricsPage", () => {
    type Sig = typeof KopaiClient.prototype.searchMetricsPage;
    expectTypeOf<Sig>().toEqualTypeOf<
      (
        filter: MetricsDataFilter,
        opts?: RequestOptions
      ) => Promise<SearchResult<OtelMetricsRow>>
    >();
  });
});

/* ------------------------------------------------------------------ */
/* Runtime: fetch contract                                             */
/* ------------------------------------------------------------------ */

describe("client.execute runtime fetch contract", () => {
  it("POSTs to /signals/traces/query with JSON.stringify(q) body (non-agg)", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          rows: [{ id: "t-1", name: "GET /" }],
          cursor: "next-cursor",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const client = new KopaiClient({ baseUrl: BASE_URL, fetch: fakeFetch });
    const q = traces
      .select({ id: traces.traceId, name: traces.spanName })
      .toQuery();
    const result = await client.execute(q);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE_URL}/signals/traces/query`);
    expect(calls[0]!.init.method).toBe("POST");
    // Phantom fields are type-only and absent at runtime
    expect(calls[0]!.init.body).toBe(JSON.stringify(q));
    const parsedBody = JSON.parse(calls[0]!.init.body as string) as Record<
      string,
      unknown
    >;
    expect(parsedBody).not.toHaveProperty("__row");
    expect(parsedBody).not.toHaveProperty("__isAgg");

    expect(result).toEqual({
      rows: [{ id: "t-1", name: "GET /" }],
      cursor: "next-cursor",
    });
  });

  it("forwards AbortSignal to underlying fetch", async () => {
    let captured: AbortSignal | null = null;
    const fakeFetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      captured = init?.signal ?? null;
      return new Response(JSON.stringify({ rows: [], cursor: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = new KopaiClient({ baseUrl: BASE_URL, fetch: fakeFetch });
    const q = traces.select({ id: traces.traceId }).toQuery();
    const controller = new AbortController();
    await client.execute(q, { signal: controller.signal });
    expect(captured).not.toBeNull();
  });

  it("returns aggregated server response shape (no cursor)", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ rows: [{ p: 42 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = new KopaiClient({ baseUrl: BASE_URL, fetch: fakeFetch });
    const q = traces.select({ p: tracesAgg.p99(traces.duration) }).toQuery();
    const result = await client.execute(q);
    expect(result).toEqual({ rows: [{ p: 42 }] });
  });
});
