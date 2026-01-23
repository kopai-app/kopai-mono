import type { SearchResult } from "./types.js";

type PageFetcher<T> = (
  cursor: string | undefined,
  signal?: AbortSignal
) => Promise<SearchResult<T>>;

/**
 * Creates an async iterator that auto-paginates through results.
 * Yields individual items from each page.
 */
export async function* paginate<T>(
  fetcher: PageFetcher<T>,
  signal?: AbortSignal
): AsyncGenerator<T, void, undefined> {
  let cursor: string | undefined;

  do {
    signal?.throwIfAborted();

    const result = await fetcher(cursor, signal);

    for (const item of result.data) {
      yield item;
    }

    cursor = result.nextCursor ?? undefined;
  } while (cursor);
}
