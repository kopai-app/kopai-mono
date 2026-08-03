import { useState, useEffect } from "react";

/**
 * Returns `value` once it has stopped changing for `delayMs`. The first value
 * is returned immediately, so an initial fetch is never delayed — only the
 * churn from a user still choosing is.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
