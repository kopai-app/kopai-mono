import { observabilityCatalog } from "@kopai/ui-core";
import type { RendererComponentProps } from "@kopai/ui-core";
import type { kopaiQuery } from "@kopai/core";
import { RawDataTable } from "../index.js";
import type { RawTableData } from "../types.js";
import { NoDataSource } from "./NoDataSource.js";
import { narrowAggregateRows } from "./narrowRows.js";

type Props = RendererComponentProps<
  typeof observabilityCatalog.components.AggregateTable
>;

// Aggregate results are dynamic `Record<string, scalar>` rows — the columns
// (dimensions + measures) vary per query — so they can't be drawn by the
// signal-specific raw renderers. Flatten them into RawDataTable's
// column/type/row shape: columns are the union of keys in first-seen order
// (the datasource SELECTs dimensions before measures), and a column is typed
// numeric only when every present value in it is a number, so RawDataTable
// right-aligns + scale-formats measures while leaving dimension labels as text.
function toTableData(rows: kopaiQuery.KopaiAggregateRow[]): RawTableData {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }

  const types = columns.map((col) => {
    let sawValue = false;
    for (const row of rows) {
      const val = row[col];
      if (val === null || val === undefined) continue;
      sawValue = true;
      if (typeof val !== "number") return "String";
    }
    return sawValue ? "Float" : "String";
  });

  const dataRows = rows.map((row) => columns.map((col) => row[col] ?? null));
  return { columns, types, rows: dataRows };
}

// The `units` prop is keyed by column name, but RawDataTable formats by
// position — measures carry no unit metadata through the query layer, so the
// dashboard author supplies it. Columns absent from the map format normally,
// which is what lets a units map drift from its query without breaking the
// other columns. `Object.hasOwn` is belt-and-braces: the catalog's
// `z.record` parse already yields a fresh plain object.
function unitsByColumn(
  columns: string[],
  units: Record<string, string> | null | undefined
): (string | null)[] | undefined {
  if (!units) return undefined;
  return columns.map((col) => lookup(units, col));
}

function lookup(record: Record<string, string>, key: string): string | null {
  return Object.hasOwn(record, key) ? (record[key] ?? null) : null;
}

// Segment tokens a column name may carry that restate its annotated unit.
// Keyed by the OTel unit, since the drop only fires when the two agree —
// "duration_ms" annotated as "ns" keeps its suffix rather than being
// silently relabelled to something the values contradict.
// Keys are the units `resolveUnitScale` actually recognises — annotating a
// column with anything else leaves the name alone, matching the fact that
// the cell won't be unit-formatted either.
const UNIT_NAME_TOKENS = new Map<string, readonly string[]>([
  ["ns", ["ns", "nanos", "nanoseconds"]],
  ["us", ["us", "micros", "microseconds"]],
  ["ms", ["ms", "millis", "milliseconds"]],
  ["s", ["s", "sec", "secs", "seconds"]],
  ["By", ["by", "b", "bytes"]],
]);

/** Splits PascalCase/camelCase, keeping acronym runs whole: HTTPRoute -> HTTP Route. */
function splitCamel(segment: string): string[] {
  return segment
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean);
}

/** All-caps and alphanumeric runs (HTTP, P95) keep their case; others Title Case. */
function capitalize(word: string): string {
  if (/^[A-Z0-9]+$/.test(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Turns a raw column name into a display header: `span_count` -> "Span Count",
 * `service.name` -> "Service Name", `SpanName` -> "Span Name". When the column
 * is unit-annotated and its last segment restates that unit, the segment is
 * dropped — `avg_duration_ns` + `ns` -> "Avg Duration" — because the formatted
 * cell already carries the unit.
 */
function humanize(column: string, unit: string | null): string {
  // Tokenise before testing the trailing unit: splitting on delimiters alone
  // leaves `avgDurationNs` as a single segment, so the suffix would survive.
  const words = column.split(/[._]+/).filter(Boolean).flatMap(splitCamel);
  const tokens = unit ? UNIT_NAME_TOKENS.get(unit) : undefined;
  const last = words[words.length - 1]?.toLowerCase();
  if (tokens && words.length > 1 && last && tokens.includes(last)) {
    words.pop();
  }
  return words.map(capitalize).join(" ");
}

// Explicit `labels` win outright; everything else is humanised. Kept here
// rather than in RawDataTable so the naming policy lives beside the props
// that drive it and the table stays a dumb renderer.
function headersByColumn(
  columns: string[],
  units: (string | null)[] | undefined,
  labels: Record<string, string> | null | undefined
): string[] {
  return columns.map((col, idx) => {
    const override = labels ? lookup(labels, col) : null;
    return override ?? humanize(col, units?.[idx] ?? null);
  });
}

export function OtelAggregateTable(props: Props) {
  if (!props.hasData) return <NoDataSource />;

  // `query` is polymorphic — accept aggregate-mode rows and surface an explicit
  // error (rather than JSON-stringifying object columns) when a raw-shaped
  // result is bound here, mirroring the raw renderers' shape validation.
  const { rows, error } = narrowAggregateRows(props.response);
  const data = toTableData(rows);
  const units = unitsByColumn(data.columns, props.element.props.units);

  return (
    <RawDataTable
      data={data}
      units={units}
      headers={headersByColumn(data.columns, units, props.element.props.labels)}
      isLoading={props.loading}
      error={props.error ?? error}
      maxRows={props.element.props.maxRows ?? 100}
    />
  );
}
