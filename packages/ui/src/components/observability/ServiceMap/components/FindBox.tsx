/**
 * Find (R2-9): a combobox over every node on the canvas, tray included.
 * Exact matches come first, then prefix matches, then substring matches
 * (label or id, case-insensitive). Choosing a result calls `onFind` with the
 * node and its position; the canvas centres on it and highlights it.
 */
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import type { NodeKind } from "../engine/types.js";

export interface FindItem {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  inTray: boolean;
}

export interface FindBoxProps {
  items: readonly FindItem[];
  onFind(item: FindItem): void;
  /** Called when the query is cleared. */
  onClear?(): void;
  maxResults?: number;
  /** Width in px (default 256). */
  width?: number;
}

const KIND_LABEL: Record<NodeKind, string> = {
  service: "service",
  database: "database",
  messaging: "queue",
  external: "external",
};

/** Ranked matches: exact, then prefix, then substring; ties by label. */
export function findMatches(
  items: readonly FindItem[],
  query: string,
  max = 8
): FindItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { item: FindItem; rank: number }[] = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    const id = item.id.toLowerCase();
    let rank: number;
    if (label === q || id === q) rank = 0;
    else if (label.startsWith(q) || id.startsWith(q)) rank = 1;
    else if (label.includes(q) || id.includes(q)) rank = 2;
    else continue;
    scored.push({ item, rank });
  }
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.item.label.localeCompare(b.item.label) ||
      a.item.id.localeCompare(b.item.id)
  );
  return scored.slice(0, max).map((s) => s.item);
}

export function FindBox({
  items,
  onFind,
  onClear,
  maxResults = 8,
  width,
}: FindBoxProps) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = useMemo(
    () => findMatches(items, query, maxResults),
    [items, query, maxResults]
  );
  const expanded = open && query.trim().length > 0;
  const current = Math.min(active, Math.max(0, matches.length - 1));

  const choose = (item: FindItem) => {
    setQuery(item.label);
    setOpen(false);
    onFind(item);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(matches.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      const item = matches[current];
      if (item) {
        e.preventDefault();
        choose(item);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div
      className={
        width === undefined
          ? "sm-find relative w-64 max-w-full"
          : "sm-find relative max-w-full"
      }
      style={width === undefined ? undefined : { width }}
    >
      <input
        type="search"
        name="service-map-find"
        role="combobox"
        aria-label="Find a service"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          expanded && matches[current] ? `${listId}-${current}` : undefined
        }
        placeholder={`Find a service (${items.length.toLocaleString("en-US")})`}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
          if (!e.target.value.trim()) onClear?.();
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-border bg-background px-2.5 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching services"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-md border border-border bg-popover py-1 text-sm shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-2.5 py-1 text-muted-foreground">No match</li>
          ) : (
            matches.map((m, i) => (
              <li
                key={m.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === current}
                title={m.label}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(m);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1 ${
                  i === current ? "bg-muted text-foreground" : "text-foreground"
                }`}
              >
                <span className="min-w-0 truncate font-mono text-xs">
                  {m.label}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {KIND_LABEL[m.kind]}
                  {m.inTray ? " · not connected" : ""}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
