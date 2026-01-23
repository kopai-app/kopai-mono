import { describe, it, expect, vi } from "vitest";
import { paginate } from "./pagination.js";
import type { SearchResult } from "./types.js";

type TestItem = { id: number };
type TestPageFetcher = (
  cursor: string | undefined,
  signal?: AbortSignal
) => Promise<SearchResult<TestItem>>;

describe("paginate", () => {
  it("yields items from single page", async () => {
    const fetcher: TestPageFetcher = vi.fn().mockResolvedValue({
      data: [{ id: 1 }, { id: 2 }],
      nextCursor: null,
    });

    const items: TestItem[] = [];
    for await (const item of paginate(fetcher)) {
      items.push(item);
    }

    expect(items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(undefined, undefined);
  });

  it("yields items from multiple pages", async () => {
    const fetcher: TestPageFetcher = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: 1 }],
        nextCursor: "cursor1",
      })
      .mockResolvedValueOnce({
        data: [{ id: 2 }],
        nextCursor: "cursor2",
      })
      .mockResolvedValueOnce({
        data: [{ id: 3 }],
        nextCursor: null,
      });

    const items: TestItem[] = [];
    for await (const item of paginate(fetcher)) {
      items.push(item);
    }

    expect(items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher).toHaveBeenNthCalledWith(1, undefined, undefined);
    expect(fetcher).toHaveBeenNthCalledWith(2, "cursor1", undefined);
    expect(fetcher).toHaveBeenNthCalledWith(3, "cursor2", undefined);
  });

  it("handles empty response", async () => {
    const fetcher: TestPageFetcher = vi.fn().mockResolvedValue({
      data: [],
      nextCursor: null,
    });

    const items: TestItem[] = [];
    for await (const item of paginate(fetcher)) {
      items.push(item);
    }

    expect(items).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();

    const fetcher: TestPageFetcher = vi.fn().mockImplementation(async () => {
      // Abort after first call
      controller.abort();
      return { data: [{ id: 1 }], nextCursor: "cursor1" };
    });

    const items: TestItem[] = [];
    await expect(async () => {
      for await (const item of paginate(fetcher, controller.signal)) {
        items.push(item);
      }
    }).rejects.toThrow();

    // Should get first item before abort check on next iteration
    expect(items).toEqual([{ id: 1 }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("passes signal to fetcher", async () => {
    const controller = new AbortController();
    const fetcher: TestPageFetcher = vi.fn().mockResolvedValue({
      data: [],
      nextCursor: null,
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _item of paginate(fetcher, controller.signal)) {
      // empty
    }

    expect(fetcher).toHaveBeenCalledWith(undefined, controller.signal);
  });
});
