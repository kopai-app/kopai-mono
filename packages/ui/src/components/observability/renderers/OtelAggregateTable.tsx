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

export function OtelAggregateTable(props: Props) {
  if (!props.hasData) return <NoDataSource />;

  // `query` is polymorphic — accept aggregate-mode rows and surface an explicit
  // error (rather than JSON-stringifying object columns) when a raw-shaped
  // result is bound here, mirroring the raw renderers' shape validation.
  const { rows, error } = narrowAggregateRows(props.response);

  return (
    <RawDataTable
      data={toTableData(rows)}
      isLoading={props.loading}
      error={props.error ?? error}
      maxRows={props.element.props.maxRows ?? 100}
    />
  );
}
