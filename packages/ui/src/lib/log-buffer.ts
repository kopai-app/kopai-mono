import type { denormalizedSignals } from "@kopai/core";

type OtelLogsRow = denormalizedSignals.OtelLogsRow;

function logKey(row: OtelLogsRow): string {
  const body = row.Body ?? "";
  let hash = 0;
  for (let i = 0; i < body.length; i++) {
    hash = (hash << 5) - hash + body.charCodeAt(i);
    hash = hash & hash;
  }
  return `${row.Timestamp}-${row.ServiceName ?? ""}-${Math.abs(hash).toString(36)}`;
}

export class LogBuffer {
  private readonly maxSize: number;
  private rows: OtelLogsRow[] = [];
  private keys = new Set<string>();

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  /** Merge new rows, dedup, sort by timestamp, trim oldest when over max. */
  merge(incoming: OtelLogsRow[]): void {
    for (const row of incoming) {
      const k = logKey(row);
      if (this.keys.has(k)) continue;
      this.keys.add(k);
      this.rows.push(row);
    }
    // Sort ascending by timestamp
    this.rows.sort((a, b) => {
      if (a.Timestamp < b.Timestamp) return -1;
      if (a.Timestamp > b.Timestamp) return 1;
      return 0;
    });
    // Trim oldest
    if (this.rows.length > this.maxSize) {
      const removed = this.rows.splice(0, this.rows.length - this.maxSize);
      for (const r of removed) this.keys.delete(logKey(r));
    }
  }

  getAll(): OtelLogsRow[] {
    return this.rows.slice();
  }

  getNewestTimestamp(): string | undefined {
    if (this.rows.length === 0) return undefined;
    return this.rows[this.rows.length - 1]!.Timestamp;
  }

  get size(): number {
    return this.rows.length;
  }

  clear(): void {
    this.rows = [];
    this.keys.clear();
  }
}
