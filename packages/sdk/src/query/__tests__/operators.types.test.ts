import { describe, it, expectTypeOf } from "vitest";
import type { ExprNode } from "@kopai/core";
import { traces, logs, metrics } from "../index.js";
import {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  like,
  in_,
  notIn,
  isNull,
  isNotNull,
  and,
  or,
  not,
} from "../operators.js";

describe("eq / ne accept any col + matching value", () => {
  it("eq/ne typed correctly", () => {
    expectTypeOf(eq(traces.spanName, "GET /")).toEqualTypeOf<ExprNode>();
    expectTypeOf(eq(traces.duration, "1000")).toEqualTypeOf<ExprNode>();
    expectTypeOf(ne(traces.spanId, "abc")).toEqualTypeOf<ExprNode>();
    expectTypeOf(eq(logs.severityNumber, 9)).toEqualTypeOf<ExprNode>();
    expectTypeOf(eq(metrics.gauge.value, 1.5)).toEqualTypeOf<ExprNode>();
    // @ts-expect-error - value type mismatch (number vs string col)
    eq(traces.spanName, 123);
    // @ts-expect-error - value type mismatch (string vs number col)
    eq(logs.severityNumber, "hi");
  });
});

describe("gt/gte/lt/lte reject map/array/bool kinds", () => {
  it("scalar kinds accepted, others rejected", () => {
    expectTypeOf(gt(traces.duration, "100")).toEqualTypeOf<ExprNode>();
    expectTypeOf(lt(traces.timestamp, "100")).toEqualTypeOf<ExprNode>();
    expectTypeOf(gte(traces.spanName, "GET")).toEqualTypeOf<ExprNode>();
    expectTypeOf(lte(logs.severityNumber, 5)).toEqualTypeOf<ExprNode>();
    // @ts-expect-error - map kind rejected
    gt(traces.spanAttributes, {});
    // @ts-expect-error - array kind rejected
    gt(traces.eventsName, []);
    // @ts-expect-error - value type mismatch
    gt(traces.duration, 100);
  });
});

describe("like requires string kind only", () => {
  it("string accepted; numericString rejected", () => {
    expectTypeOf(like(traces.spanName, "GET%")).toEqualTypeOf<ExprNode>();
    // @ts-expect-error - numericString rejected
    like(traces.duration, "1%");
    // @ts-expect-error - number rejected
    like(logs.severityNumber, "1");
    // @ts-expect-error - map rejected
    like(traces.spanAttributes, "x");
  });
});

describe("in_ / notIn accept arrays of matching element type", () => {
  it("typed correctly", () => {
    expectTypeOf(in_(traces.spanName, ["a", "b"])).toEqualTypeOf<ExprNode>();
    expectTypeOf(notIn(logs.severityNumber, [1, 2])).toEqualTypeOf<ExprNode>();
    // @ts-expect-error - element type mismatch
    in_(traces.spanName, [1, 2]);
    // @ts-expect-error - element type mismatch
    notIn(logs.severityNumber, ["a"]);
  });
});

describe("isNull / isNotNull accept any column", () => {
  it("typed correctly", () => {
    expectTypeOf(isNull(traces.duration)).toEqualTypeOf<ExprNode>();
    expectTypeOf(isNotNull(traces.spanAttributes)).toEqualTypeOf<ExprNode>();
    expectTypeOf(isNull(traces.eventsName)).toEqualTypeOf<ExprNode>();
  });
});

describe("and / or accept ExprNode[] only; not accepts one ExprNode", () => {
  it("typed correctly", () => {
    const a = eq(traces.spanName, "x");
    const b = isNull(traces.duration);
    expectTypeOf(and(a, b)).toEqualTypeOf<ExprNode>();
    expectTypeOf(or(a, b)).toEqualTypeOf<ExprNode>();
    expectTypeOf(not(a)).toEqualTypeOf<ExprNode>();
    // @ts-expect-error - non-Expr arg rejected
    and(a, 42);
    // @ts-expect-error - non-Expr arg rejected
    or("hello");
    // @ts-expect-error - non-Expr arg rejected
    not(42);
  });
});
