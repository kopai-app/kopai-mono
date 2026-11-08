import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceMapEngine } from "../engine/engine.js";
import { applyCommand, isMainToWorker, type WorkerToMain } from "./protocol.js";
import { handleMessage, type WorkerScope } from "./service-map.worker.js";

interface FetchCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A `fetch` that answers the two endpoints the engine uses with empty data. */
function stubFetch(): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      const data = url.endsWith("/signals/services")
        ? { services: [] }
        : url.endsWith("/signals/query/traces/aggregate")
          ? { data: [] }
          : { data: [], nextCursor: null };
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
  return calls;
}

function fakeScope() {
  const posted: WorkerToMain[] = [];
  const scope: WorkerScope = {
    postMessage: (m) => void posted.push(m),
    addEventListener: () => {},
  };
  const snapshots = () =>
    posted.flatMap((m) => (m.type === "snapshot" ? [m.snapshot] : []));
  return { scope, posted, snapshots };
}

describe("worker shell handleMessage", () => {
  let scopes: WorkerScope[];

  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 7, 12, 0, 0) });
    vi.spyOn(console, "debug").mockImplementation(() => {});
    scopes = [];
  });

  afterEach(() => {
    for (const s of scopes) handleMessage(s, { type: "stop" });
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function init(msg: Record<string, unknown>) {
    const f = fakeScope();
    scopes.push(f.scope);
    handleMessage(f.scope, { type: "init", ...msg });
    return f;
  }

  it("init builds a KopaiClient on the absolute baseUrl with the auth", async () => {
    const calls = stubFetch();
    init({
      baseUrl: "http://kopai.test:8000/",
      token: "tok",
      headers: { "X-Tenant": "t1" },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(calls.length).toBeGreaterThanOrEqual(1);
    // Trailing slash stripped; the first seed request (getServices) goes to
    // the absolute URL.
    expect(calls[0]!.url).toBe("http://kopai.test:8000/signals/services");
    expect(calls[0]!.headers).toMatchObject({
      Authorization: "Bearer tok",
      "X-Tenant": "t1",
    });
  });

  it("relays engine snapshots to the main thread", async () => {
    const calls = stubFetch();
    const { posted, snapshots } = init({ baseUrl: "http://kopai.test" });
    // The engine emits its first snapshot synchronously on start.
    expect(snapshots()).toHaveLength(1);
    expect(snapshots()[0]!.scan.state).toBe("seeding");

    // Seed (getServices + 2 aggregates) + an empty backward page: the scan stops with
    // no-more-data and the relayed snapshot shows it.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls.map((c) => c.url.replace("http://kopai.test", ""))).toEqual(
      expect.arrayContaining([
        "/signals/services",
        "/signals/query/traces/aggregate",
        "/signals/traces/search",
      ])
    );
    const last = snapshots().at(-1)!;
    expect(snapshots().length).toBeGreaterThan(1);
    expect(last.seq).toBeGreaterThan(1);
    expect(last.scan.stopReason).toBe("no-more-data");
    expect(posted.every((m) => m.type === "snapshot")).toBe(true);
  });

  it("a relative baseUrl is fatal (blob workers cannot resolve it)", async () => {
    const calls = stubFetch();
    const { posted } = init({ baseUrl: "/" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.type).toBe("fatal");
    expect(calls).toHaveLength(0);
  });

  it("pause holds requests, resume continues, stop ends the engine", async () => {
    const calls = stubFetch();
    const { scope, snapshots } = init({ baseUrl: "http://kopai.test" });
    await vi.advanceTimersByTimeAsync(5_000); // scan done, now live
    const before = calls.length;

    handleMessage(scope, { type: "pause" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.length).toBe(before);

    handleMessage(scope, { type: "resume" });
    await vi.advanceTimersByTimeAsync(15_000); // ≥ one 10 s forward poll
    expect(calls.length).toBeGreaterThan(before);

    handleMessage(scope, { type: "stop" });
    const stoppedCalls = calls.length;
    const stoppedSnaps = snapshots().length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.length).toBe(stoppedCalls);
    expect(snapshots().length).toBe(stoppedSnaps);
  });

  it("an init with paused: true starts the engine paused: no request until resume", async () => {
    const calls = stubFetch();
    const { scope } = init({ baseUrl: "http://kopai.test", paused: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(0);
    handleMessage(scope, { type: "resume" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.map((c) => c.url)).toContain(
      "http://kopai.test/signals/services"
    );
  });

  it("a second init on the same scope is ignored (one engine per worker)", async () => {
    const calls = stubFetch();
    const { scope, snapshots } = init({ baseUrl: "http://kopai.test" });
    handleMessage(scope, { type: "init", baseUrl: "http://other.test" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls.every((c) => c.url.startsWith("http://kopai.test/"))).toBe(
      true
    );
    expect(snapshots().filter((s) => s.seq === 1)).toHaveLength(1);
  });

  it("ignores stray messages and commands before init", () => {
    const calls = stubFetch();
    const { scope, posted } = fakeScope();
    handleMessage(scope, { type: "pause" });
    handleMessage(scope, "hello");
    handleMessage(scope, null);
    handleMessage(scope, { type: "init" }); // no baseUrl
    expect(posted).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});

describe("protocol", () => {
  it("applyCommand maps each command to the engine method", () => {
    const engine = {
      pause: vi.fn(),
      resume: vi.fn(),
      retry: vi.fn(),
      stop: vi.fn(),
    };
    const e = engine as unknown as ServiceMapEngine;
    applyCommand(e, { type: "pause" });
    applyCommand(e, { type: "resume" });
    applyCommand(e, { type: "retry" });
    applyCommand(e, { type: "stop" });
    expect(engine.pause).toHaveBeenCalledTimes(1);
    expect(engine.resume).toHaveBeenCalledTimes(1);
    expect(engine.retry).toHaveBeenCalledTimes(1);
    expect(engine.stop).toHaveBeenCalledTimes(1);
  });

  it("isMainToWorker accepts only known messages", () => {
    expect(isMainToWorker({ type: "init", baseUrl: "http://x" })).toBe(true);
    expect(isMainToWorker({ type: "init" })).toBe(false);
    expect(isMainToWorker({ type: "resume" })).toBe(true);
    expect(isMainToWorker({ type: "restart" })).toBe(false);
    expect(isMainToWorker(undefined)).toBe(false);
    expect(isMainToWorker("pause")).toBe(false);
  });
});
