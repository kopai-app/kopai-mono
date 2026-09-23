// Turning a union's "Invalid input" into something a caller can act on.
//
// WHY this exists: `KopaiQuery`'s branches contain further unions — a measure
// expression, a column reference, a filter node. When one of those fails, zod
// reports the failure at the union itself with the bare message "Invalid
// input", because it has no way to know which member the caller was reaching
// for. That is the least useful message on the three fields a caller is most
// likely to get wrong, and the tool contract promises issues that can be
// repaired from.
//
// The approach is to answer the question zod declines to: re-parse the value
// against each member, work out which one the caller most likely meant, and
// report that member's own issues instead. Where no member fits, say what the
// union accepts.
//
// Nothing here changes what is accepted or rejected. It rewrites message text
// and issue paths only.

import { z } from "zod";

import type { KopaiQueryIssue } from "./kopai-query-compiler-types.js";

type Schema = z.ZodType;

/** How many accepted values to name before summarising the rest. */
const SAMPLE_SIZE = 8;

interface ZodDefLike {
  type?: string;
  innerType?: Schema;
  getter?: () => Schema;
  element?: Schema;
  shape?: Record<string, Schema>;
  options?: Schema[];
  entries?: Record<string, unknown>;
  values?: unknown[];
}

function def(schema: Schema | undefined): ZodDefLike | undefined {
  return (schema as unknown as { _zod?: { def?: ZodDefLike } })?._zod?.def;
}

/**
 * Peels wrappers off a schema: optional/nullable/default, and `lazy`, which
 * the self-referential filter expression is built from — without resolving it
 * the filter union looks like a schema with no members at all.
 */
function unwrap(schema: Schema | undefined): Schema | undefined {
  let current = schema;
  for (let guard = 0; current && guard < 20; guard++) {
    const d = def(current);
    if (
      d?.type === "optional" ||
      d?.type === "nullable" ||
      d?.type === "default"
    ) {
      current = d.innerType;
      continue;
    }
    if (d?.type === "lazy" && d.getter) {
      current = d.getter();
      continue;
    }
    return current;
  }
  return current;
}

/** The schema governing `path` within `root`, if it can be reached. */
function schemaAt(root: Schema, path: PropertyKey[]): Schema | undefined {
  let current = unwrap(root);
  for (const key of path) {
    const d = def(current);
    if (d?.type === "object") current = unwrap(d.shape?.[String(key)]);
    else if (d?.type === "array") current = unwrap(d.element);
    else return undefined;
    if (!current) return undefined;
  }
  return current;
}

/** The value at `path` within `value`, if it can be reached. */
function valueAt(value: unknown, path: PropertyKey[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[String(key)];
  }
  return current;
}

/** Keys of an object schema whose value is a single literal. */
function literalKeys(option: Schema): Map<string, unknown> {
  const shape = def(unwrap(option))?.shape;
  const out = new Map<string, unknown>();
  if (!shape) return out;
  for (const [key, member] of Object.entries(shape)) {
    const d = def(unwrap(member));
    if (d?.type === "literal") {
      const values = d.values ?? [];
      if (values.length === 1) out.set(key, values[0]);
    }
  }
  return out;
}

/** Accepted values of an enum schema, in declaration order. */
function enumValues(schema: Schema | undefined): string[] | undefined {
  const d = def(unwrap(schema));
  if (d?.type !== "enum") return undefined;
  return Object.keys(d.entries ?? {});
}

/** "a, b, c and 129 others" — the whole list is already in the tool schema. */
function summarise(values: string[]): string {
  if (values.length <= SAMPLE_SIZE)
    return values.map((v) => `"${v}"`).join(", ");
  const shown = values
    .slice(0, SAMPLE_SIZE)
    .map((v) => `"${v}"`)
    .join(", ");
  return `${shown} and ${values.length - SAMPLE_SIZE} others`;
}

/** Collapses case and punctuation, so "ServiceName" meets "service.name". */
function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function didYouMean(value: string, candidates: string[]): string | undefined {
  const target = fold(value);
  return candidates.find((candidate) => fold(candidate) === target);
}

/** Accepted values for `key` across a union member: a literal, or an enum. */
function acceptedAt(option: Schema, key: string): string[] {
  const member = unwrap(def(unwrap(option))?.shape?.[key]);
  const d = def(member);
  if (d?.type === "literal") {
    return (d.values ?? []).filter((v): v is string => typeof v === "string");
  }
  return enumValues(member) ?? [];
}

/**
 * When every member rejects the value on the same field, the caller named
 * something that no variant accepts — so the useful answer is the union of
 * what all of them would accept there, not one member's slice of it.
 */
function explainCommonKey(
  attempts: readonly {
    option: Schema;
    issues: readonly { path: PropertyKey[]; message: string }[];
  }[],
  value: unknown,
  path: string
): KopaiQueryIssue | undefined {
  if (!attempts.length) return undefined;

  const keysOf = (a: (typeof attempts)[number]) =>
    new Set(
      a.issues.filter((i) => i.path.length === 1).map((i) => String(i.path[0]))
    );
  const shared = attempts
    .map(keysOf)
    .reduce((a, b) => new Set([...a].filter((k) => b.has(k))));
  if (shared.size !== 1) return undefined;

  const key = [...shared][0] as string;
  const accepted = [
    ...new Set(attempts.flatMap((a) => acceptedAt(a.option, key))),
  ];
  if (!accepted.length) return undefined;

  const sent = valueAt(value, [key]);
  const suggestion = didYouMean(String(sent), accepted);
  return {
    path: path ? `${path}.${key}` : key,
    message: suggestion
      ? `Unknown ${key} ${typeof sent === "string" ? `"${sent}"` : String(sent)}. Did you mean "${suggestion}"?`
      : `Expected ${key} to be one of ${summarise(accepted)}.`,
  };
}

/**
 * How many of the value's own keys this member actually declares.
 *
 * A member may itself be a union — the filter expression mixes the
 * discriminated leaf set with the `and`/`or` shapes — and a union has no shape
 * of its own. Scoring it zero put the leaf level with wrappers that declare
 * none of its keys, so a leaf with two mistakes lost on issue count to a
 * wrapper's single "expected array", and the caller was told to add an `and`
 * they never meant to write. Its best member's score is the union's.
 */
function keyOverlap(option: Schema, value: unknown): number {
  const d = def(unwrap(option));
  if (d?.type === "union") {
    return Math.max(0, ...(d.options ?? []).map((o) => keyOverlap(o, value)));
  }
  const shape = d?.shape;
  if (!shape || value === null || typeof value !== "object") return 0;
  return Object.keys(value as Record<string, unknown>).filter((k) => k in shape)
    .length;
}

interface Attempt {
  option: Schema;
  issues: readonly { path: PropertyKey[]; message: string }[];
  wrongShape: boolean;
}

function attemptAll(union: Schema, value: unknown): Attempt[] {
  const options = def(union)?.options ?? [];
  return options.map((option) => {
    const result = option.safeParse(value);
    const issues = result.success ? [] : result.error.issues;
    const literals = literalKeys(option);
    // An issue on a literal key means the caller was not reaching for this
    // member at all — the discriminator saying "wrong shape", rather than a
    // mistake being reported inside the right shape.
    const wrongShape = issues.some(
      (issue) => issue.path.length === 1 && literals.has(String(issue.path[0]))
    );
    return { option, issues, wrongShape };
  });
}

/** The union member the caller most likely meant, if one is identifiable. */
function chooseOption(attempts: readonly Attempt[], value: unknown) {
  const identified = attempts.filter((a) => !a.wrongShape && a.issues.length);
  if (!identified.length) return undefined;
  // Key overlap first: a value carrying `column`, `op` and `value` is reaching
  // for the leaf filter, not for the `and`/`or` wrappers, however few issues
  // those happen to produce. Fewest issues breaks the remaining ties.
  return identified.reduce((a, b) => {
    const byOverlap = keyOverlap(b.option, value) - keyOverlap(a.option, value);
    if (byOverlap !== 0) return byOverlap > 0 ? b : a;
    return b.issues.length < a.issues.length ? b : a;
  });
}

/**
 * A value that missed an enum. Names the near miss when there is one, and
 * otherwise a sample — the full list is already in the advertised schema, and
 * some of these enums run to over a hundred entries.
 */
function explainEnumMiss(
  values: string[],
  value: unknown,
  path: string,
  hint: string
): KopaiQueryIssue {
  const suggestion =
    typeof value === "string" ? didYouMean(value, values) : undefined;
  const sent = typeof value === "string" ? `"${value}"` : String(value);
  return {
    path,
    message: suggestion
      ? `Unknown value ${sent}. Did you mean "${suggestion}"?`
      : `Unknown value ${sent}. Expected one of ${summarise(values)}.${hint}`,
  };
}

/** Recursion bound, because the filter schema refers to itself. */
const MAX_DEPTH = 5;

function explainAt(
  schema: Schema,
  value: unknown,
  issues: readonly { path: PropertyKey[]; message: string }[],
  prefix: PropertyKey[],
  depth: number,
  hint: string
): KopaiQueryIssue[] {
  return issues.flatMap((issue) => {
    const fullPath = [...prefix, ...issue.path].map(String).join(".");
    const target = schemaAt(schema, issue.path);
    const targetValue = valueAt(value, issue.path);
    const kind = def(target)?.type;

    if (target && kind === "union" && depth < MAX_DEPTH) {
      // Does this union offer an attribute-reference escape hatch alongside a
      // column enum? If so, say so when the enum is missed further down.
      const options = def(target)?.options ?? [];
      const nextHint =
        options.some((o) => def(unwrap(o))?.type === "object") &&
        options.some((o) => enumValues(o)?.length)
          ? " Use { container, key } for an attribute that is not a known column."
          : hint;

      const attempts = attemptAll(target, targetValue);
      const common = explainCommonKey(attempts, targetValue, fullPath);
      if (common) return [common];

      const best = chooseOption(attempts, targetValue);
      if (best) {
        return explainAt(
          best.option,
          targetValue,
          best.issues,
          [...prefix, ...issue.path],
          depth + 1,
          nextHint
        );
      }
    }

    if (target && kind === "enum") {
      const values = enumValues(target);
      if (values?.length) {
        return [explainEnumMiss(values, targetValue, fullPath, hint)];
      }
    }

    return [{ path: fullPath, message: issue.message }];
  });
}

/**
 * Rewrites any issue that lands on a union or an enum into something
 * actionable, leaving every other issue exactly as zod reported it.
 */
export function explainIssues(
  branchSchema: Schema,
  value: unknown,
  issues: readonly { path: PropertyKey[]; message: string }[]
): KopaiQueryIssue[] {
  return explainAt(branchSchema, value, issues, [], 0, "");
}
