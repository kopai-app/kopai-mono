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

/**
 * The part of a zod issue this module reads. `code` and `keys` are present
 * only on an unrecognized-key issue, which names its keys in the message
 * rather than in the path.
 */
interface IssueLike {
  path: PropertyKey[];
  message: string;
  code?: string;
  keys?: readonly string[];
}

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
    current = stepInto(current, key);
    if (!current) return undefined;
  }
  return current;
}

/** The schema governing `key` inside `current`, if it can be reached. */
function stepInto(
  current: Schema | undefined,
  key: PropertyKey
): Schema | undefined {
  const d = def(current);
  if (d?.type === "object") return unwrap(d.shape?.[String(key)]);
  if (d?.type === "array") return unwrap(d.element);
  if (d?.type === "union") return acrossMembers(d.options ?? [], key);
  return undefined;
}

/**
 * The schema at `key` across a union's members.
 *
 * WHY a union has to be walked into at all: zod reports a discriminator
 * mismatch at the discriminator, not at the union — `filters.0.op`, not
 * `filters.0`. Stopping at the union left every such issue with zod's own
 * text, so the five discriminators in this schema (`op`, `orderBy.type`,
 * `timeDimension.type`, `output.type`) and any enum inside a member
 * (`direction`) kept a message this module exists to replace.
 *
 * A union has no shape of its own, so the answer is whatever its members
 * declare at that key. Identical members collapse to one. A set of literals
 * and enums collapses into a single enum over every value they accept, which
 * is both the honest answer — any of them is accepted there — and the form the
 * message layer can act on. Anything else is offered as a union, for the
 * caller's value to be re-parsed against member by member.
 */
function acrossMembers(
  options: readonly Schema[],
  key: PropertyKey
): Schema | undefined {
  const members = [
    ...new Set(
      options
        .map((option) => stepInto(unwrap(option), key))
        .filter((schema): schema is Schema => !!schema)
    ),
  ];
  if (members.length <= 1) return members[0];

  const valueSets = members.map(literalOrEnumValues);
  if (valueSets.every((values) => values?.length)) {
    const values = [...new Set(valueSets.flat())] as string[];
    return z.enum(values as [string, ...string[]]);
  }
  return z.union(members);
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

/** The string values a schema accepts, if it is a literal or an enum. */
function literalOrEnumValues(schema: Schema | undefined): string[] | undefined {
  const d = def(unwrap(schema));
  if (d?.type === "literal") {
    const values = (d.values ?? []).filter(
      (value): value is string => typeof value === "string"
    );
    return values.length ? values : undefined;
  }
  return enumValues(schema);
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

/**
 * Whether `sent` is `declared` with one character inserted, deleted or
 * substituted, or with two adjacent characters swapped.
 *
 * A bounded edit distance rather than a general one: these are the slips keys
 * actually attract — a dropped plural, a doubled letter, a transposition —
 * and a wider budget starts renaming keys into ones the caller never wrote.
 */
function isNearMiss(sent: string, declared: string): boolean {
  if (sent === declared) return true;
  const [shorter, longer] =
    sent.length <= declared.length ? [sent, declared] : [declared, sent];
  if (longer.length - shorter.length > 1) return false;

  let head = 0;
  while (head < shorter.length && shorter[head] === longer[head]) head++;
  let tail = 0;
  while (
    tail < shorter.length - head &&
    shorter[shorter.length - 1 - tail] === longer[longer.length - 1 - tail]
  )
    tail++;

  // One insertion or deletion: the differing run is the single extra
  // character. Equal lengths: one substitution, or a swap of the two
  // characters the run covers.
  const run = shorter.length - head - tail;
  if (longer.length !== shorter.length) return run === 0;
  if (run <= 1) return true;
  return (
    run === 2 &&
    shorter[head] === longer[head + 1] &&
    shorter[head + 1] === longer[head]
  );
}

/**
 * The declared key a misspelling was probably reaching for.
 *
 * `didYouMean` alone is not enough here: it collapses case and punctuation,
 * which catches `orderby` for `orderBy` but not a dropped plural (`filter`) or
 * a doubled letter (`limitt`). A tie between two candidates yields nothing,
 * because naming one of them would be a guess.
 */
function nearestKey(key: string, declared: string[]): string | undefined {
  // A key is never a correction for itself, however it got into the list.
  const candidates = declared.filter((candidate) => candidate !== key);
  const exact = didYouMean(key, candidates);
  if (exact) return exact;

  const folded = fold(key);
  const near = candidates.filter((candidate) =>
    isNearMiss(folded, fold(candidate))
  );
  return near.length === 1 ? near[0] : undefined;
}

/**
 * Every key the schema at a path declares. A union has no shape of its own,
 * so it contributes each member's keys — a filter node accepts a leaf's keys
 * or a wrapper's, and the caller is owed both.
 */
function declaredKeys(schema: Schema | undefined): string[] {
  const d = def(unwrap(schema));
  if (!d) return [];
  if (d.type === "union") {
    return [...new Set((d.options ?? []).flatMap((o) => declaredKeys(o)))];
  }
  return Object.keys(d.shape ?? {});
}

/**
 * The union members the value could still be, given what it already says.
 *
 * WHY narrowing matters here: `declaredKeys` merges every member's keys, which
 * answers "what may appear at this node" — but a caller who wrote `op: "in"`
 * has already chosen a member, and offering them `value` because a sibling
 * member accepts it is how `Unknown key "value". Did you mean "value"?` came to
 * be printed. A member is out when a literal or enum key it declares rejects
 * what the value carries there, and out when it shares no key with the value at
 * all — the `and`/`or` wrapper beside a leaf. Where nothing survives, nothing
 * is known about the caller's intent, so the whole union answers.
 */
function plausibleMembers(
  schema: Schema | undefined,
  value: unknown
): Schema[] {
  const d = def(unwrap(schema));
  if (d?.type !== "union") return schema ? [unwrap(schema) as Schema] : [];

  const members = (d.options ?? []).flatMap((option) =>
    plausibleMembers(option, value)
  );
  const fits = members.filter((member) => {
    if (keyOverlap(member, value) === 0) return false;
    const shape = def(unwrap(member))?.shape ?? {};
    return Object.entries(shape).every(([key, declared]) => {
      const accepted = literalOrEnumValues(declared);
      const sent = valueAt(value, [key]);
      return !accepted || typeof sent !== "string" || accepted.includes(sent);
    });
  });
  return fits.length ? fits : members;
}

/** The keys accepted at a node, for the value that is actually there. */
function acceptedKeysAt(schema: Schema | undefined, value: unknown): string[] {
  const members = plausibleMembers(schema, value);
  if (!members.length) return declaredKeys(schema);
  return [...new Set(members.flatMap(declaredKeys))];
}

/**
 * An unrecognized key, reported one issue per key.
 *
 * zod reports these on the enclosing object with the keys only in the
 * message, which leaves the caller to find them; every other issue this
 * module returns names its field in the path.
 */
function explainUnknownKeys(
  keys: readonly string[],
  target: Schema | undefined,
  value: unknown,
  path: string
): KopaiQueryIssue[] {
  const declared = acceptedKeysAt(target, value);
  return keys.map((key) => {
    const suggestion = nearestKey(key, declared);
    const accepted = declared.length
      ? ` Accepted keys here: ${summarise(declared)}.`
      : "";
    return {
      path: path ? `${path}.${key}` : key,
      message: suggestion
        ? `Unknown key "${key}". Did you mean "${suggestion}"?`
        : `Unknown key "${key}".${accepted}`,
    };
  });
}

/** Accepted values for `key` across a union member: a literal, or an enum. */
function acceptedAt(option: Schema, key: string): string[] {
  return literalOrEnumValues(def(unwrap(option))?.shape?.[key]) ?? [];
}

/**
 * When every member rejects the value on the same field, the caller named
 * something that no variant accepts — so the useful answer is the union of
 * what all of them would accept there, not one member's slice of it.
 */
interface CommonKey {
  issue: KopaiQueryIssue;
  key: string;
  /** The accepted value the caller was probably reaching for, if identifiable. */
  suggestion?: string;
}

function explainCommonKey(
  attempts: readonly {
    option: Schema;
    issues: readonly IssueLike[];
  }[],
  value: unknown,
  path: string
): CommonKey | undefined {
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
    key,
    suggestion,
    issue: {
      path: path ? `${path}.${key}` : key,
      message: suggestion
        ? `Unknown ${key} ${typeof sent === "string" ? `"${sent}"` : String(sent)}. Did you mean "${suggestion}"?`
        : `Expected ${key} to be one of ${summarise(accepted)}.`,
    },
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
  issues: readonly IssueLike[];
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
  if (value === undefined) {
    return {
      path,
      message: `Required. Expected one of ${summarise(values)}.${hint}`,
    };
  }
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

/**
 * Recursion bound, because the filter schema refers to itself.
 *
 * Every `and`/`or` level spends one unit of this budget before any of it
 * reaches the leaf, so at 5 a filter nested four wrappers deep fell back to
 * the bare "Invalid input" this module exists to remove. The cost of a level
 * is one member re-parse of a value that is shrinking as it descends, so the
 * budget can be generous; 12 covers about ten levels of nesting, past anything
 * a hand-written or generated filter reaches.
 */
const MAX_DEPTH = 12;

function explainAt(
  schema: Schema,
  value: unknown,
  issues: readonly IssueLike[],
  prefix: PropertyKey[],
  depth: number,
  hint: string
): KopaiQueryIssue[] {
  // A misspelled key also makes the key it was meant to be look missing:
  // `valu` for `value` is reported both as an unrecognized key and as a
  // missing `value`. Both describe one mistake, and the half worth reporting
  // is the key the caller actually wrote — the other names a field they never
  // sent. Suppressed only where the suggested key really is absent, so a
  // genuine problem with a key they did send always survives.
  const explained = new Set<string>();
  for (const issue of issues) {
    if (issue.code !== "unrecognized_keys") continue;
    const declared = acceptedKeysAt(
      schemaAt(schema, issue.path),
      valueAt(value, issue.path)
    );
    for (const key of issue.keys ?? []) {
      const suggestion = nearestKey(key, declared);
      if (!suggestion) continue;
      const suggestedPath = [...issue.path, suggestion];
      if (valueAt(value, suggestedPath) === undefined) {
        explained.add(suggestedPath.map(String).join("."));
      }
    }
  }

  return issues.flatMap((issue) => {
    const fullPath = [...prefix, ...issue.path].map(String).join(".");
    if (
      issue.code !== "unrecognized_keys" &&
      explained.has(issue.path.map(String).join("."))
    ) {
      return [];
    }
    const target = schemaAt(schema, issue.path);
    const targetValue = valueAt(value, issue.path);
    const kind = def(target)?.type;

    // Ahead of the union branch: an unrecognized key is already precise about
    // what is wrong, and re-parsing the value against each member to find out
    // why would only rediscover the same key in every one of them.
    if (issue.code === "unrecognized_keys" && issue.keys?.length) {
      return explainUnknownKeys(issue.keys, target, targetValue, fullPath);
    }

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
      if (common) {
        // The suggestion names the variant the caller was reaching for, so
        // that variant's other issues apply and are worth reporting together:
        // `{op: "avg", as: "c"}` is two mistakes, and answering only the `op`
        // costs a round trip to discover the missing `column`.
        //
        // Without a suggestion there is no way to tell which variant was
        // meant, and one member's requirements are not the others' — a COUNT
        // measure needs no `column` — so reporting them would invent a rule
        // the caller may not be subject to. The common key alone it is.
        const variant = common.suggestion
          ? attempts.find((attempt) =>
              acceptedAt(attempt.option, common.key).includes(
                common.suggestion as string
              )
            )
          : undefined;
        const siblings = variant
          ? explainAt(
              variant.option,
              targetValue,
              variant.issues.filter(
                (i) => i.path.length === 0 || String(i.path[0]) !== common.key
              ),
              [...prefix, ...issue.path],
              depth + 1,
              nextHint
            )
          : [];
        return [common.issue, ...siblings];
      }

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
  issues: readonly IssueLike[]
): KopaiQueryIssue[] {
  return explainAt(branchSchema, value, issues, [], 0, "");
}
