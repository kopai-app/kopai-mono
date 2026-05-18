/**
 * Boolean-expression operators used inside `.where()`.
 *
 * Each operator constructs a typed `ExprNode` directly. Kind-based
 * narrowing on the column ref enforces eligibility:
 * - `eq/ne`: any column.
 * - `gt/gte/lt/lte`: scalar kinds only ('number'|'numericString'|'string'|'date').
 * - `like`: 'string' only.
 * - `in_/notIn`: any column; value array element type must match.
 * - `isNull/isNotNull`: any column.
 * - `and/or/not`: logical combinators over ExprNode.
 */
import type { ExprNode } from "@kopai/core";
import type { ColumnRef, Kind } from "./columns.js";

/** Kinds that admit ordered comparison. */
type OrderedKind = "number" | "numericString" | "string" | "date";

export function eq<Name extends string, T, K extends Kind>(
  col: ColumnRef<Name, T, K>,
  value: T
): ExprNode {
  return { kind: "eq", col: col.toNode(), value };
}

export function ne<Name extends string, T, K extends Kind>(
  col: ColumnRef<Name, T, K>,
  value: T
): ExprNode {
  return { kind: "ne", col: col.toNode(), value };
}

export function gt<Name extends string, T, K extends OrderedKind>(
  col: ColumnRef<Name, T, K>,
  value: T
): ExprNode {
  return { kind: "gt", col: col.toNode(), value };
}

export function gte<Name extends string, T, K extends OrderedKind>(
  col: ColumnRef<Name, T, K>,
  value: T
): ExprNode {
  return { kind: "gte", col: col.toNode(), value };
}

export function lt<Name extends string, T, K extends OrderedKind>(
  col: ColumnRef<Name, T, K>,
  value: T
): ExprNode {
  return { kind: "lt", col: col.toNode(), value };
}

export function lte<Name extends string, T, K extends OrderedKind>(
  col: ColumnRef<Name, T, K>,
  value: T
): ExprNode {
  return { kind: "lte", col: col.toNode(), value };
}

export function like<Name extends string, T>(
  col: ColumnRef<Name, T, "string">,
  value: T
): ExprNode {
  return { kind: "like", col: col.toNode(), value };
}

export function in_<Name extends string, T, K extends Kind>(
  col: ColumnRef<Name, T, K>,
  values: T[]
): ExprNode {
  return { kind: "in", col: col.toNode(), values };
}

export function notIn<Name extends string, T, K extends Kind>(
  col: ColumnRef<Name, T, K>,
  values: T[]
): ExprNode {
  return { kind: "notIn", col: col.toNode(), values };
}

export function isNull<Name extends string, T, K extends Kind>(
  col: ColumnRef<Name, T, K>
): ExprNode {
  return { kind: "isNull", col: col.toNode() };
}

export function isNotNull<Name extends string, T, K extends Kind>(
  col: ColumnRef<Name, T, K>
): ExprNode {
  return { kind: "isNotNull", col: col.toNode() };
}

export function and(...exprs: ExprNode[]): ExprNode {
  return { kind: "and", exprs };
}

export function or(...exprs: ExprNode[]): ExprNode {
  return { kind: "or", exprs };
}

export function not(expr: ExprNode): ExprNode {
  return { kind: "not", expr };
}
