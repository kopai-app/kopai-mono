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

type BinaryKind = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like";
type SetKind = "in" | "notIn";
type NullKind = "isNull" | "isNotNull";

function binary<K extends BinaryKind>(kind: K) {
  return <Name extends string, T, Kn extends Kind>(
    col: ColumnRef<Name, T, Kn>,
    value: T
  ): ExprNode => ({ kind, col: col.toNode(), value });
}

function setOp<K extends SetKind>(kind: K) {
  return <Name extends string, T, Kn extends Kind>(
    col: ColumnRef<Name, T, Kn>,
    values: T[]
  ): ExprNode => ({ kind, col: col.toNode(), values });
}

function nullOp<K extends NullKind>(kind: K) {
  return <Name extends string, T, Kn extends Kind>(
    col: ColumnRef<Name, T, Kn>
  ): ExprNode => ({ kind, col: col.toNode() });
}

export const eq = binary("eq");
export const ne = binary("ne");

export const gt = binary("gt") as <
  Name extends string,
  T,
  K extends OrderedKind,
>(
  col: ColumnRef<Name, T, K>,
  value: T
) => ExprNode;
export const gte = binary("gte") as typeof gt;
export const lt = binary("lt") as typeof gt;
export const lte = binary("lte") as typeof gt;

export const like = binary("like") as <Name extends string, T>(
  col: ColumnRef<Name, T, "string">,
  value: T
) => ExprNode;

export const in_ = setOp("in");
export const notIn = setOp("notIn");

export const isNull = nullOp("isNull");
export const isNotNull = nullOp("isNotNull");

export function and(...exprs: ExprNode[]): ExprNode {
  return { kind: "and", exprs };
}

export function or(...exprs: ExprNode[]): ExprNode {
  return { kind: "or", exprs };
}

export function not(expr: ExprNode): ExprNode {
  return { kind: "not", expr };
}
