/**
 * Local re-exports of core AST types + a structural copy of the
 * attribute-value type used by the row-type phantom (kept here so
 * row-type assertions match exactly without depending on internal
 * `@kopai/core` exports).
 */
export type {
  ColumnRefNode,
  AggCallNode,
  ExprNode,
  OrderBy,
} from "@kopai/core";

/** Attribute-map source identifier. Mirrors core's `attributeMapNameSchema`. */
export type AttributeMapName =
  | "spanAttributes"
  | "resourceAttributes"
  | "logAttributes"
  | "eventAttributes"
  | "scopeAttributes"
  | "attributes";

/**
 * JSON-shaped attribute value. Matches `denormalized-signals-zod.ts`
 * AttributeValue type (kept structurally identical for row-type
 * inference).
 */
export type AttributeValue =
  | string
  | number
  | boolean
  | AttributeValue[]
  | { [key: string]: AttributeValue };
