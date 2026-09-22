// Hoists structurally identical subschemas of a JSON Schema 2020-12 document
// into `$defs` and replaces each occurrence with a `$ref`.
//
// WHY: the `query` tool advertises the whole KopaiQuery union as its input
// schema, and the union repeats the same column enums, filter expressions and
// time-dimension shapes across all six branches. Emitted verbatim the document
// is ~132k characters, and a host carries it in its `tools:` array on every
// turn, not once per connection. Deduplication is the only reduction that
// costs the model nothing: every alternative measured (dropping descriptions,
// collapsing enums) removes exactly the text a model needs to build a correct
// query.
//
// WHY keyword-aware rather than a blind object walk: in JSON Schema a nested
// object is not always a schema. `properties` maps property *names* to
// schemas, so its keys must not be treated as keywords; `const`, `enum`,
// `examples` and `default` hold data that may look like a schema but is not.
// Hoisting a value out of one of those would change what the document
// accepts. The three sets below enumerate the only places a schema may
// legally appear.

type SchemaNode = Record<string, unknown>;

/** Keywords whose value is a single schema. */
const SCHEMA_VALUE = new Set([
  "items",
  "additionalProperties",
  "additionalItems",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "unevaluatedItems",
  "unevaluatedProperties",
]);

/** Keywords whose value is an array of schemas. */
const SCHEMA_ARRAY = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);

/** Keywords whose value maps arbitrary names to schemas. */
const SCHEMA_MAP = new Set([
  "properties",
  "patternProperties",
  "dependentSchemas",
  "$defs",
  "definitions",
]);

/**
 * Rebuilds `node`, invoking `cb` on every descendant that is itself a schema.
 * Returning a value from `cb` replaces that subtree; returning `undefined`
 * descends into it. The root is never offered to `cb` — a document cannot be
 * replaced by a reference to itself.
 */
function eachSchema(
  node: unknown,
  cb: (node: SchemaNode) => SchemaNode | undefined,
  isRoot = false
): unknown {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;
  const obj = node as SchemaNode;

  if (!isRoot) {
    const replacement = cb(obj);
    if (replacement !== undefined) return replacement;
  }

  const out: SchemaNode = {};
  for (const [key, value] of Object.entries(obj)) {
    if (
      SCHEMA_VALUE.has(key) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      out[key] = eachSchema(value, cb);
    } else if (SCHEMA_ARRAY.has(key) && Array.isArray(value)) {
      out[key] = value.map((s) => eachSchema(s, cb));
    } else if (SCHEMA_MAP.has(key) && value && typeof value === "object") {
      out[key] = Object.fromEntries(
        Object.entries(value as SchemaNode).map(([name, s]) => [
          name,
          eachSchema(s, cb),
        ])
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Returns `doc` with every subschema that occurs more than once hoisted into
 * `$defs`.
 *
 * `minLen` is the serialized length below which a repeat is not worth a
 * reference — a `$ref` costs about 30 characters, so hoisting anything
 * shorter makes the document bigger. Any existing `$defs` are preserved and
 * deduplicated alongside the body.
 */
export function dedupe(doc: SchemaNode, minLen = 60): SchemaNode {
  const existingDefs = (doc.$defs as Record<string, SchemaNode>) ?? {};

  // 1. Count structurally identical nodes. The root is excluded, and each
  //    existing $defs body is counted from its own root for the same reason.
  const counts = new Map<string, number>();
  const body = { ...doc };
  delete body.$defs;

  const count = (n: SchemaNode): undefined => {
    const key = JSON.stringify(n);
    if (key.length >= minLen) counts.set(key, (counts.get(key) ?? 0) + 1);
    return undefined;
  };

  eachSchema(body, count, true);
  for (const def of Object.values(existingDefs)) eachSchema(def, count, true);

  // 2. Hoist everything seen at least twice. Longest first, so that a large
  //    repeated shape becomes one definition rather than being shredded into
  //    references to its own parts.
  const refNames = new Map<string, string>();
  const newDefs: Record<string, SchemaNode> = {};
  let next = 0;
  for (const [key, seen] of [...counts.entries()].sort(
    (a, b) => b[0].length - a[0].length
  )) {
    if (seen < 2) continue;
    const name = `s${next++}`;
    refNames.set(key, name);
    newDefs[name] = JSON.parse(key) as SchemaNode;
  }

  const substitute = (n: SchemaNode): SchemaNode | undefined => {
    const name = refNames.get(JSON.stringify(n));
    return name === undefined ? undefined : { $ref: `#/$defs/${name}` };
  };

  // 3. Rewrite the document, then each hoisted body. A body must skip the
  //    match against itself, or every definition becomes a reference to
  //    itself and the document stops meaning anything.
  const result = eachSchema(doc, substitute, true) as SchemaNode;
  const defs: Record<string, SchemaNode> = {
    ...((result.$defs as Record<string, SchemaNode>) ?? {}),
  };

  for (const [name, defBody] of [
    ...Object.entries(newDefs),
    ...Object.entries(existingDefs),
  ]) {
    const self = JSON.stringify(defBody);
    defs[name] = eachSchema(
      defBody,
      (n) => (JSON.stringify(n) === self ? undefined : substitute(n)),
      true
    ) as SchemaNode;
  }

  result.$defs = defs;
  return result;
}
