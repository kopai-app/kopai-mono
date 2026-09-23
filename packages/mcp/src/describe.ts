// Rewriting the advertised schema's guidance without touching the shared one.
//
// WHY this exists: the `KopaiQuery` schema is shared with the REST routes, and
// some of what it says is true there and false here. Its `limit` field
// advertises "Hard cap = 10000", which is REST's cap; this tool refuses
// anything above 200 or 500. A model reading the field-level description —
// the text nearest the decision — writes a limit it will be refused for.
//
// The same schema is also silent on cost. It says what `granularity` and
// `dimensions` mean, but not that together they set the row count, which is
// the thing that decides whether a query succeeds.
//
// Both are fixed in the copy this tool advertises, leaving the shared schema
// alone. Matching is by description prefix rather than by path, because the
// same field appears once per signal with slightly different wording, and a
// path list would rot silently. A test asserts every override still matches
// something, so a reworded schema fails loudly instead of quietly dropping
// the guidance.

type SchemaNode = Record<string, unknown>;

export interface DescriptionOverride {
  /** Start of the description to match, in the shared schema. */
  readonly prefix: string;
  /** Replaces the description outright, or extends it. */
  readonly mode: "replace" | "append";
  readonly text: string;
}

export function descriptionOverrides(
  rawMax: number,
  aggregateMax: number,
  rawDefault: number,
  aggregateDefault: number
): DescriptionOverride[] {
  return [
    {
      prefix: "Maximum rows to return.",
      mode: "replace",
      text: `Maximum rows to return. This tool caps it at ${rawMax} in raw mode and ${aggregateMax} in aggregate mode, and refuses a higher value rather than quietly lowering it. Omit it for ${rawDefault} in raw mode and ${aggregateDefault} in aggregate mode. The two modes then differ: raw mode truncates to the limit and returns a cursor for the rest, while aggregate mode refuses a result that exceeds it outright, returning no rows.`,
    },
    {
      prefix: "Bucket width.",
      mode: "append",
      text: " A time series returns one row per group per bucket, so halving this doubles the rows returned.",
    },
    {
      prefix: "GROUP BY columns.",
      mode: "append",
      text: " The row count is the number of distinct value combinations here, multiplied by the bucket count when output is a time series. A high-cardinality column such as a span name, a route or a user id can exceed the row cap on its own.",
    },
  ];
}

/**
 * Returns `doc` with each override applied wherever its prefix matches, and a
 * count per override so a caller can tell whether any stopped matching.
 */
export function applyDescriptions(
  doc: SchemaNode,
  overrides: readonly DescriptionOverride[]
): { document: SchemaNode; applied: Record<string, number> } {
  const applied: Record<string, number> = Object.fromEntries(
    overrides.map((o) => [o.prefix, 0])
  );

  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== "object") return value;

    const node = { ...(value as SchemaNode) };
    const description = node.description;
    if (typeof description === "string") {
      for (const override of overrides) {
        if (!description.startsWith(override.prefix)) continue;
        node.description =
          override.mode === "replace"
            ? override.text
            : description + override.text;
        applied[override.prefix] = (applied[override.prefix] ?? 0) + 1;
        break;
      }
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === "description") continue;
      node[key] = rewrite(child);
    }
    return node;
  };

  return { document: rewrite(doc) as SchemaNode, applied };
}
