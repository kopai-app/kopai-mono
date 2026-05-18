/**
 * Shared AST node Zod schemas for the KopaiQuery wire format.
 *
 * These schemas are signal-agnostic. Per-signal column-name and agg-fn
 * validation lives in `traces-kopai-query-zod.ts`,
 * `logs-kopai-query-zod.ts`, and `metrics-kopai-query-zod.ts`, which compose
 * `kopaiQueryBaseSchema` and apply `.superRefine` checks against the
 * signal-specific enums.
 *
 * The `kind` discriminator strings (`'col' | 'attr' | 'agg' | 'eq' | …`)
 * are wire-format identifiers; keep them short and stable.
 *
 * Numeric durations and timestamps are always JSON strings of nanoseconds
 * — the same convention used by `denormalized-signals-zod.ts` for
 * `otelLogsSchema.Timestamp` (line 137). No bigint anywhere.
 */
import { z } from "zod";

/**
 * A JSON-compatible scalar that may appear on the right-hand side of a
 * binary expression node (eq, ne, gt, …). Strings cover nanosecond
 * timestamps/durations encoded per the wire convention.
 */
const jsonScalarSchema: z.ZodType = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .describe(
    "A JSON-compatible scalar used as the right-hand side of a binary expression (string, number, boolean, null). Nanosecond timestamps and durations are encoded as strings."
  );

/**
 * Attribute-map source identifier. The list mirrors the record-typed
 * columns across the otel*Schema signals (span/resource/log/scope/events).
 */
export const attributeMapNameSchema = z
  .enum([
    "spanAttributes",
    "resourceAttributes",
    "logAttributes",
    "eventAttributes",
    "scopeAttributes",
    "attributes",
  ])
  .describe(
    "Name of an attribute map column (e.g. 'spanAttributes', 'resourceAttributes'). Identifies which Map<string, AttrValue> to index into when constructing an attribute column reference."
  );

/**
 * Reference to either a top-level column (`{ kind: 'col', name }`) or a
 * single key inside an attribute map column (`{ kind: 'attr', map, key }`).
 *
 * Per-signal column-name validation is layered on by the signal-specific
 * query schemas — this base schema only enforces structural shape.
 */
export const columnRefNodeSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z
          .literal("col")
          .describe(
            "Discriminator marking this node as a top-level column reference."
          ),
        name: z
          .string()
          .describe(
            "CamelCased column identifier (e.g. 'traceId', 'duration'). Validated against the per-signal column-name enum by the enclosing query schema."
          ),
      })
      .describe("Reference to a top-level column on the signal's row type."),
    z
      .object({
        kind: z
          .literal("attr")
          .describe(
            "Discriminator marking this node as an attribute-map index."
          ),
        map: attributeMapNameSchema,
        key: z
          .string()
          .describe(
            "Key looked up inside the attribute map (e.g. 'http.route', 'service.version')."
          ),
      })
      .describe(
        "Reference to a single key inside a Map<string, AttrValue> column."
      ),
  ])
  .describe(
    "Reference to a column in a query — either a top-level row column or a single attribute-map key."
  );

export type ColumnRefNode = z.infer<typeof columnRefNodeSchema>;

/**
 * Optional arguments accepted by aggregation calls:
 * - `n` — used by `topN` to limit the value set returned.
 * - `windowNs` — nanosecond-string window for `rate*` aggregates, matching
 *   the timestamp convention at `denormalized-signals-zod.ts:137`.
 */
const aggCallArgsSchema = z
  .object({
    n: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Limit argument for topN aggregations (number of buckets returned)."
      ),
    windowNs: z
      .string()
      .optional()
      .describe(
        "Window size for rate* aggregations, expressed as a nanosecond JSON string (same convention as otelLogsSchema.Timestamp)."
      ),
  })
  .describe("Optional positional / keyword arguments for an aggregation call.");

/**
 * Aggregation call node. `col` is optional because `count()` takes no
 * column argument. The per-signal query schema validates `fn` against the
 * signal-specific agg-fn enum.
 */
export const aggCallNodeSchema = z
  .object({
    kind: z
      .literal("agg")
      .describe("Discriminator marking this node as an aggregation call."),
    fn: z
      .string()
      .describe(
        "Aggregation function name (e.g. 'count', 'sum', 'p99'). Validated against the per-signal agg-fn enum by the enclosing query schema."
      ),
    col: columnRefNodeSchema
      .optional()
      .describe(
        "Column the aggregation is applied over. Omitted for aggregations that take no column (currently only `count`)."
      ),
    args: aggCallArgsSchema
      .optional()
      .describe(
        "Optional aggregation arguments (e.g. topN's `n`, rate*'s `windowNs`)."
      ),
  })
  .describe(
    "An aggregation call used inside a query's `select` map (e.g. p99(duration), count())."
  );

export type AggCallNode = z.infer<typeof aggCallNodeSchema>;

/**
 * Recursive boolean-expression tree used by the `where` clause.
 *
 * Discriminated by `kind`. Binary comparisons carry a `col` + `value`; set
 * comparisons (`in`, `notIn`) carry `col` + `values`; logical combinators
 * carry nested `exprs` / `expr`; unary nullness checks carry only `col`.
 */
export type ExprNode =
  | { kind: "eq"; col: ColumnRefNode; value: unknown }
  | { kind: "ne"; col: ColumnRefNode; value: unknown }
  | { kind: "gt"; col: ColumnRefNode; value: unknown }
  | { kind: "gte"; col: ColumnRefNode; value: unknown }
  | { kind: "lt"; col: ColumnRefNode; value: unknown }
  | { kind: "lte"; col: ColumnRefNode; value: unknown }
  | { kind: "like"; col: ColumnRefNode; value: unknown }
  | { kind: "in"; col: ColumnRefNode; values: unknown[] }
  | { kind: "notIn"; col: ColumnRefNode; values: unknown[] }
  | { kind: "isNull"; col: ColumnRefNode }
  | { kind: "isNotNull"; col: ColumnRefNode }
  | { kind: "and"; exprs: ExprNode[] }
  | { kind: "or"; exprs: ExprNode[] }
  | { kind: "not"; expr: ExprNode };

const binaryExprSchema = (kind: ExprNode["kind"], doc: string) =>
  z
    .object({
      kind: z.literal(kind).describe(`Discriminator for ${kind} comparison.`),
      col: columnRefNodeSchema,
      value: jsonScalarSchema,
    })
    .describe(doc);

const setExprSchema = (kind: "in" | "notIn", doc: string) =>
  z
    .object({
      kind: z
        .literal(kind)
        .describe(`Discriminator for ${kind} set comparison.`),
      col: columnRefNodeSchema,
      values: z
        .array(jsonScalarSchema)
        .describe(`Set of values to compare ${kind} against.`),
    })
    .describe(doc);

const nullnessExprSchema = (kind: "isNull" | "isNotNull", doc: string) =>
  z
    .object({
      kind: z.literal(kind).describe(`Discriminator for ${kind} check.`),
      col: columnRefNodeSchema,
    })
    .describe(doc);

export const exprNodeSchema: z.ZodType<ExprNode> = z.lazy(
  () =>
    // Cast through `unknown` because zod 4's `discriminatedUnion` infers the
    // union with merged `kind` literals (`kind: 'eq' | 'ne' | ...`), while
    // the hand-written `ExprNode` is a distributed union — structurally
    // equivalent but not assignable without a cast.
    z
      .discriminatedUnion("kind", [
        binaryExprSchema("eq", "Equality comparison: col === value."),
        binaryExprSchema("ne", "Inequality comparison: col !== value."),
        binaryExprSchema(
          "gt",
          "Greater-than comparison: col > value (scalar columns only)."
        ),
        binaryExprSchema("gte", "Greater-or-equal comparison: col >= value."),
        binaryExprSchema(
          "lt",
          "Less-than comparison: col < value (scalar columns only)."
        ),
        binaryExprSchema("lte", "Less-or-equal comparison: col <= value."),
        binaryExprSchema(
          "like",
          "SQL LIKE comparison on a string column (use %/_ wildcards)."
        ),
        setExprSchema(
          "in",
          "Set membership: col is in the provided value set."
        ),
        setExprSchema(
          "notIn",
          "Set non-membership: col is not in the provided value set."
        ),
        nullnessExprSchema("isNull", "Nullness check: col IS NULL."),
        nullnessExprSchema("isNotNull", "Nullness check: col IS NOT NULL."),
        z
          .object({
            kind: z.literal("and").describe("Discriminator for logical AND."),
            exprs: z
              .array(exprNodeSchema)
              .describe("Sub-expressions conjoined with AND."),
          })
          .describe("Logical AND across one or more sub-expressions."),
        z
          .object({
            kind: z.literal("or").describe("Discriminator for logical OR."),
            exprs: z
              .array(exprNodeSchema)
              .describe("Sub-expressions disjoined with OR."),
          })
          .describe("Logical OR across one or more sub-expressions."),
        z
          .object({
            kind: z.literal("not").describe("Discriminator for logical NOT."),
            expr: exprNodeSchema,
          })
          .describe("Logical NOT of a single sub-expression."),
      ])
      .describe(
        "Recursive boolean-expression tree used by the `where` clause of a KopaiQuery."
      ) as unknown as z.ZodType<ExprNode>
);

/**
 * Sort ordering: a column ref + direction. `dir` is restricted to a small
 * literal enum so callers cannot drift from canonical SQL ordering.
 */
export const orderBySchema = z
  .object({
    col: columnRefNodeSchema,
    dir: z
      .enum(["asc", "desc"])
      .describe("Sort direction: 'asc' (ascending) or 'desc' (descending)."),
  })
  .describe("A single ORDER BY clause: a column reference plus a direction.");

export type OrderBy = z.infer<typeof orderBySchema>;

/**
 * Closed time range. Both endpoints are nanosecond JSON strings, matching
 * the wire convention used everywhere else for timestamps (see
 * `denormalized-signals-zod.ts:137`). No bigint.
 */
export const timeRangeSchema = z
  .object({
    start: z
      .string()
      .describe(
        "Range start (inclusive). UNIX Epoch time in nanoseconds, expressed as a string in JSON."
      ),
    end: z
      .string()
      .describe(
        "Range end (exclusive). UNIX Epoch time in nanoseconds, expressed as a string in JSON."
      ),
  })
  .describe(
    "Closed time range used to constrain a query. Both endpoints are nanosecond JSON strings."
  );

export type TimeRange = z.infer<typeof timeRangeSchema>;

/**
 * A value that can appear inside `select`: either a column reference or
 * an aggregation call.
 */
export const selectValueSchema = z
  .union([columnRefNodeSchema, aggCallNodeSchema])
  .describe(
    "A single value of a query `select` map — either a column reference or an aggregation call."
  );

export type SelectValueNode = z.infer<typeof selectValueSchema>;

/**
 * Shared base for every per-signal KopaiQuery schema. Signal-specific
 * schemas `.extend()` this with `signal` (and `metricType` for metrics)
 * and add `.superRefine` checks that validate column names and agg fns
 * against the signal's enums.
 *
 * NOTE: this is exported for composition by the per-signal modules but
 * is not intended to be parsed directly by callers — it skips per-signal
 * validation that the user-facing schemas enforce.
 */
export const kopaiQueryBaseSchema = z
  .object({
    select: z
      .record(z.string(), selectValueSchema)
      .describe(
        "Map of output field name → column reference or aggregation call. Output field names become row keys in the response."
      ),
    where: exprNodeSchema
      .optional()
      .describe(
        "Optional boolean filter expression applied before aggregation."
      ),
    groupBy: z
      .array(columnRefNodeSchema)
      .optional()
      .describe(
        "Optional GROUP BY columns. Required when select contains an aggregation call alongside non-aggregated columns."
      ),
    orderBy: z
      .array(orderBySchema)
      .optional()
      .describe("Optional ORDER BY clauses applied to the result set."),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Optional maximum number of rows to return."),
    timeRange: timeRangeSchema
      .optional()
      .describe(
        "Optional time-range constraint applied to the signal's timestamp column."
      ),
    cursor: z
      .string()
      .optional()
      .describe(
        "Opaque pagination cursor from a previous response. Only valid for non-aggregated queries — the per-signal schema rejects this when any select value is an aggregation."
      ),
  })
  .describe("Base shape of a KopaiQuery, common to traces / logs / metrics.");

/**
 * Helper used by per-signal `.superRefine` checks to validate the column
 * names + agg fns in a query's `select`, `groupBy`, `orderBy`, `where`,
 * and to enforce the cursor-only-when-non-aggregated invariant.
 *
 * Pass a column-name predicate + agg-fn predicate; the function pushes
 * targeted issues onto `ctx`.
 */
export function refineKopaiQuery<
  T extends {
    select: Record<string, SelectValueNode>;
    cursor?: string;
    groupBy?: ColumnRefNode[];
    orderBy?: OrderBy[];
    where?: ExprNode;
  },
>(
  data: T,
  ctx: z.RefinementCtx,
  isValidColumnName: (n: string) => boolean,
  isValidAggFn: (fn: string) => boolean
): void {
  const validateColRef = (col: ColumnRefNode, path: (string | number)[]) => {
    if (col.kind === "col" && !isValidColumnName(col.name)) {
      ctx.addIssue({
        code: "custom",
        message: `Unknown column name: '${col.name}'`,
        path: [...path, "name"],
      });
    }
  };

  const walkExpr = (expr: ExprNode, path: (string | number)[]) => {
    if (
      expr.kind === "eq" ||
      expr.kind === "ne" ||
      expr.kind === "gt" ||
      expr.kind === "gte" ||
      expr.kind === "lt" ||
      expr.kind === "lte" ||
      expr.kind === "like" ||
      expr.kind === "in" ||
      expr.kind === "notIn" ||
      expr.kind === "isNull" ||
      expr.kind === "isNotNull"
    ) {
      validateColRef(expr.col, [...path, "col"]);
    } else if (expr.kind === "and" || expr.kind === "or") {
      expr.exprs.forEach((sub, i) => walkExpr(sub, [...path, "exprs", i]));
    } else if (expr.kind === "not") {
      walkExpr(expr.expr, [...path, "expr"]);
    }
  };

  let hasAgg = false;
  for (const [key, val] of Object.entries(data.select)) {
    if (val.kind === "col" || val.kind === "attr") {
      validateColRef(val, ["select", key]);
    } else if (val.kind === "agg") {
      hasAgg = true;
      if (!isValidAggFn(val.fn)) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown aggregation function for this signal: '${val.fn}'`,
          path: ["select", key, "fn"],
        });
      }
      if (val.col) validateColRef(val.col, ["select", key, "col"]);
    }
  }

  if (data.groupBy) {
    data.groupBy.forEach((col, i) => validateColRef(col, ["groupBy", i]));
  }
  if (data.orderBy) {
    data.orderBy.forEach((ob, i) =>
      validateColRef(ob.col, ["orderBy", i, "col"])
    );
  }
  if (data.where) {
    walkExpr(data.where, ["where"]);
  }

  if (hasAgg && data.cursor !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: "cursor is incompatible with aggregated select",
      path: ["cursor"],
    });
  }
}
