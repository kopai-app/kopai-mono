/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { M_MS } from "../engine/config.js";
import type { ServiceMapClient, ServiceMapSnapshot } from "../engine/types.js";
import type { MainToWorker, WorkerToMain } from "../worker/protocol.js";
import {
  __resetSessionsForTests,
  absoluteBaseUrl,
  acquire,
  IDLE_STOP_MS,
  RELEASE_GRACE_MS,
  stableJson,
  workerKey,
} from "./session-manager.js";
import { useServiceMap } from "./use-service-map.js";

// ------------------------------------------------------------ fake worker

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: MainToWorker[] = [];
  terminated = false;
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(m: MainToWorker) {
    this.posted.push(m);
  }
  addEventListener(type: string, l: (e: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }
  terminate() {
    this.terminated = true;
  }
  emit(m: WorkerToMain) {
    for (const l of this.listeners.get("message") ?? []) l({ data: m });
  }
  fail() {
    for (const l of this.listeners.get("error") ?? []) l(new Event("error"));
  }
  types() {
    return this.posted.map((m) => m.type);
  }
}

const createWorker = vi.hoisted(() => ({
  impl: null as null | (() => Promise<Worker>),
}));
vi.mock("../worker/create-worker.js", () => ({
  createServiceMapWorker: () =>
    createWorker.impl
      ? createWorker.impl()
      : Promise.resolve(new FakeWorker() as unknown as Worker),
}));

// ------------------------------------------------------------ fake client

function mockClient() {
  const counts = { aggregate: 0, search: 0, backward: 0 };
  const client = {
    queryTracesAggregate: vi.fn(async () => {
      counts.aggregate++;
      return { data: [] };
    }),
    searchTracesPage: vi.fn(async (f: { sortOrder?: string }) => {
      counts.search++;
      if (f.sortOrder === "DESC") counts.backward++;
      return { data: [], nextCursor: null };
    }),
    getTrace: vi.fn(async () => []),
    getServices: vi.fn(async () => ({ services: [] })),
  };
  return { client: client as unknown as ServiceMapClient, counts };
}

function snap(seq: number): ServiceMapSnapshot {
  return { seq } as unknown as ServiceMapSnapshot;
}

// ------------------------------------------------------------- visibility

let hidden = false;
function setHidden(h: boolean) {
  hidden = h;
  document.dispatchEvent(new Event("visibilitychange"));
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 7, 12, 0, 0) });
  FakeWorker.instances = [];
  createWorker.impl = null;
  hidden = false;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
});

afterEach(() => {
  cleanup();
  __resetSessionsForTests();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------------ keys

describe("session keys", () => {
  it("absoluteBaseUrl resolves relative URLs against the page", () => {
    expect(absoluteBaseUrl("")).toBe(location.origin);
    expect(absoluteBaseUrl("/")).toBe(location.origin);
    expect(absoluteBaseUrl("/api/")).toBe(`${location.origin}/api`);
    expect(absoluteBaseUrl("http://kopai.test:8000/")).toBe(
      "http://kopai.test:8000"
    );
  });

  it("stableJson ignores key order and undefined values", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: [1, "x"] } })).toBe(
      stableJson({ a: { c: [1, "x"], d: 2 }, b: 1, z: undefined })
    );
    expect(workerKey({ baseUrl: "/", headers: { a: "1", b: "2" } })).toBe(
      workerKey({ baseUrl: location.origin, headers: { b: "2", a: "1" } })
    );
    expect(workerKey({ baseUrl: "/", token: "a" })).not.toBe(
      workerKey({ baseUrl: "/", token: "b" })
    );
  });
});

// ------------------------------------------------------------ in-process

describe("in-process sessions (custom client)", () => {
  it("two acquires with the same client share one engine and its snapshots", async () => {
    const { client, counts } = mockClient();
    const a = acquire({ client });
    const b = acquire({ client });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(a.transport()).toBe("in-process");
    expect(counts.aggregate).toBe(2); // one seed, not two
    expect(a.getSnapshot()).not.toBeNull();
    expect(a.getSnapshot()).toBe(b.getSnapshot());

    const seen: number[] = [];
    b.subscribe(() => seen.push(b.getSnapshot()!.seq));
    await vi.advanceTimersByTimeAsync(30_000); // forward polls → new snapshots
    expect(seen.length).toBeGreaterThan(0);
    expect(a.getSnapshot()).toBe(b.getSnapshot());
  });

  it("releasing every handle pauses the engine; coming back resumes the same graph; unused for M stops it", async () => {
    const { client, counts } = mockClient();
    const a = acquire({ client });
    const b = acquire({ client });
    await vi.advanceTimersByTimeAsync(5_000);
    a.release();
    a.release(); // idempotent: does not drop b's reference
    await vi.advanceTimersByTimeAsync(30_000);
    const live = counts.search;
    expect(live).toBeGreaterThan(1); // still polling for b

    b.release();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS - 1);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1);
    // Paused, not stopped: no requests while no view uses it.
    const atPause = counts.search;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(counts.search).toBe(atPause);
    const slot = b.layoutSlot;

    // Coming back (e.g. traces tab → map tab) resumes the same session:
    // no new seed, the same layout slot, and polling again.
    const c = acquire({ client });
    expect(c.layoutSlot).toBe(slot);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(counts.aggregate).toBe(2);
    expect(counts.search).toBeGreaterThan(atPause);

    // Unused for M: the session is stopped and every timer cleared.
    c.release();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS + IDLE_STOP_MS);
    const atStop = counts.search;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(counts.search).toBe(atStop);
    expect(vi.getTimerCount()).toBe(0);

    // A later acquire starts a fresh session (a new seed).
    const d = acquire({ client });
    expect(d.layoutSlot).not.toBe(slot);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(counts.aggregate).toBe(4);
    d.release();
  });

  it("acquire → release → acquire within 1 s (StrictMode) starts no second scan", async () => {
    const { client, counts } = mockClient();
    const first = acquire({ client });
    first.release();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS / 2);
    const second = acquire({ client });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(counts.aggregate).toBe(2);
    expect(second.getSnapshot()).not.toBeNull();
    second.release();
  });

  it("two client instances get two sessions; the same instance twice gets one", async () => {
    const x = mockClient();
    const y = mockClient();
    const a = acquire({ client: x.client });
    const b = acquire({ client: y.client });
    const a2 = acquire({ client: x.client });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(x.counts.aggregate).toBe(2);
    expect(y.counts.aggregate).toBe(2);
    expect(a.getSnapshot()).toBe(a2.getSnapshot());
    expect(a.getSnapshot()).not.toBe(b.getSnapshot());
  });

  it("a hidden document pauses the engine; visible again resumes it", async () => {
    const { client, counts } = mockClient();
    acquire({ client });
    await vi.advanceTimersByTimeAsync(5_000);
    setHidden(true);
    await flush();
    const atHide = counts.search;
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(counts.search).toBe(atHide); // no polls while hidden

    setHidden(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(counts.search).toBeGreaterThan(atHide);
    // Short gap (< M, and < the 5 min seed refresh): no restart, no new seed,
    // no second backward scan.
    expect(counts.aggregate).toBe(2);
    expect(counts.backward).toBe(1);
  });

  it("hidden for longer than M restarts the session (new seed)", async () => {
    const { client, counts } = mockClient();
    const h = acquire({ client });
    await vi.advanceTimersByTimeAsync(5_000);
    const before = h.getSnapshot()!;
    setHidden(true);
    await vi.advanceTimersByTimeAsync(M_MS + 60_000);
    expect(counts.aggregate).toBe(2);

    expect(counts.backward).toBe(1);

    setHidden(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(counts.aggregate).toBe(4);
    // A restart, not just a seed refresh: the backward scan runs again.
    expect(counts.backward).toBe(2);
    // Coverage restarted from the new "now".
    expect(h.getSnapshot()!.coverage.toMs).toBeGreaterThan(
      before.coverage.toMs ?? 0
    );
  });

  it("starts paused when the document is already hidden", async () => {
    hidden = true;
    const { client, counts } = mockClient();
    acquire({ client });
    await vi.advanceTimersByTimeAsync(60_000);
    // At most the request that was already issued on start.
    expect(counts.aggregate + counts.search).toBeLessThanOrEqual(1);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(counts.aggregate).toBe(2);
    expect(counts.search).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- worker

describe("worker sessions (default client)", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", FakeWorker);
  });

  it("starts one worker with an absolute baseUrl and relays its snapshots", async () => {
    const h = acquire({ baseUrl: "", token: "t" });
    await flush();
    expect(h.transport()).toBe("worker");
    expect(FakeWorker.instances).toHaveLength(1);
    const w = FakeWorker.instances[0]!;
    expect(w.posted[0]).toEqual({
      type: "init",
      baseUrl: location.origin,
      token: "t",
    });

    const seen: (number | undefined)[] = [];
    h.subscribe(() => seen.push(h.getSnapshot()?.seq));
    w.emit({ type: "snapshot", snapshot: snap(1) });
    w.emit({ type: "snapshot", snapshot: snap(2) });
    expect(seen).toEqual([1, 2]);
    expect(h.getSnapshot()!.seq).toBe(2);

    h.retry();
    expect(w.types()).toEqual(["init", "retry"]);
  });

  it("same baseUrl relative and absolute → one worker; different token → two", async () => {
    acquire({ baseUrl: "/" });
    acquire({ baseUrl: location.origin + "/" });
    await flush();
    expect(FakeWorker.instances).toHaveLength(1);

    acquire({ baseUrl: "/", token: "a" });
    acquire({ baseUrl: "/", token: "b" });
    await flush();
    expect(FakeWorker.instances).toHaveLength(3);
    const tokens = FakeWorker.instances.map(
      (w) => (w.posted[0] as { token?: string }).token
    );
    expect(tokens).toEqual([undefined, "a", "b"]);
  });

  it("release pauses the worker after the grace period and terminates it after M unused", async () => {
    const a = acquire({ baseUrl: "/" });
    const b = acquire({ baseUrl: "/" });
    await flush();
    const w = FakeWorker.instances[0]!;
    a.release();
    b.release();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS - 1);
    expect(w.terminated).toBe(false);
    // StrictMode-style re-acquire inside the grace keeps the worker.
    const c = acquire({ baseUrl: "/" });
    await vi.advanceTimersByTimeAsync(5 * RELEASE_GRACE_MS);
    expect(w.terminated).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);

    c.release();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS);
    expect(w.terminated).toBe(false);
    expect(w.types().at(-1)).toBe("pause");
    // Back within M: the same worker resumes.
    const d = acquire({ baseUrl: "/" });
    expect(w.types().at(-1)).toBe("resume");
    expect(FakeWorker.instances).toHaveLength(1);
    d.release();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS + IDLE_STOP_MS);
    expect(w.terminated).toBe(true);
    expect(w.types().at(-1)).toBe("stop");
  });

  it("document hidden sends pause; visible again sends resume", async () => {
    acquire({ baseUrl: "/" });
    await flush();
    const w = FakeWorker.instances[0]!;
    setHidden(true);
    expect(w.types()).toEqual(["init", "pause"]);
    setHidden(false);
    expect(w.types()).toEqual(["init", "pause", "resume"]);
  });

  it("hidden while the worker loads: init is followed by pause", async () => {
    hidden = true;
    acquire({ baseUrl: "/" });
    await flush();
    expect(FakeWorker.instances[0]!.types()).toEqual(["init", "pause"]);
  });

  it("released before the worker loaded: the worker is terminated on arrival", async () => {
    let resolve!: (w: Worker) => void;
    createWorker.impl = () => new Promise<Worker>((r) => (resolve = r));
    const h = acquire({ baseUrl: "/" });
    h.release();
    await vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS + IDLE_STOP_MS);
    const w = new FakeWorker();
    resolve(w as unknown as Worker);
    await flush();
    expect(w.terminated).toBe(true);
    expect(w.posted).toHaveLength(0);
  });
});

// -------------------------------------------------------------- fallback

describe("fallback to the in-process engine", () => {
  function stubFetch() {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const body = url.endsWith("/signals/services")
          ? { services: [] }
          : url.endsWith("/aggregate")
            ? { data: [] }
            : { data: [], nextCursor: null };
        return new Response(JSON.stringify(body), { status: 200 });
      })
    );
    return urls;
  }

  it("uses in-process when Worker does not exist", async () => {
    const urls = stubFetch();
    expect(typeof Worker).toBe("undefined");
    const h = acquire({ baseUrl: "/" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.transport()).toBe("in-process");
    expect(urls[0]).toBe(`${location.origin}/signals/services`);
    expect(h.getSnapshot()).not.toBeNull();
  });

  it("uses in-process when the worker cannot be created (e.g. CSP)", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const urls = stubFetch();
    createWorker.impl = () => Promise.reject(new Error("SecurityError"));
    const h = acquire({ baseUrl: "/", token: "t" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.transport()).toBe("in-process");
    expect(urls.length).toBeGreaterThan(0);
  });

  it("a fatal or error from the worker switches to in-process", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    stubFetch();
    const a = acquire({ baseUrl: "/" });
    const b = acquire({ baseUrl: "/x" });
    await flush();
    const [wa, wb] = FakeWorker.instances;
    wa!.emit({ type: "fatal", message: "boom" });
    wb!.fail();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(wa!.terminated).toBe(true);
    expect(wb!.terminated).toBe(true);
    expect(a.transport()).toBe("in-process");
    expect(b.transport()).toBe("in-process");
    expect(a.getSnapshot()).not.toBeNull();
    // A late message from the dead worker is ignored.
    const current = a.getSnapshot();
    wa!.emit({ type: "snapshot", snapshot: snap(999) });
    expect(a.getSnapshot()).toBe(current);
  });

  it("a custom client never uses the worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { client } = mockClient();
    const h = acquire({ client, baseUrl: "/" });
    await flush();
    expect(h.transport()).toBe("in-process");
    expect(FakeWorker.instances).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ hook

describe("useServiceMap", () => {
  function Probe(props: {
    client: ServiceMapClient;
    out: { seq: number | null }[];
  }) {
    const { snapshot } = useServiceMap({ client: props.client });
    props.out.push({ seq: snapshot?.seq ?? null });
    return createElement("span", null, snapshot ? `seq ${snapshot.seq}` : "-");
  }

  it("renders snapshots and survives a StrictMode double mount with one scan", async () => {
    const { client, counts } = mockClient();
    const out: { seq: number | null }[] = [];
    const view = render(
      createElement(StrictMode, null, createElement(Probe, { client, out }))
    );
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(counts.aggregate).toBe(2);
    expect(view.container.textContent).toMatch(/^seq \d+$/);

    // Two views share the session.
    const out2: { seq: number | null }[] = [];
    const view2 = render(createElement(Probe, { client, out: out2 }));
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(counts.aggregate).toBe(2);
    expect(view2.container.textContent).toBe(view.container.textContent);

    view.unmount();
    view2.unmount();
    const atUnmount = counts.search;
    await act(() => vi.advanceTimersByTimeAsync(RELEASE_GRACE_MS + 60_000));
    expect(counts.search).toBe(atUnmount);
  });
});
