/// <reference types="vitest/globals" />
import { kopaiQuery } from "@kopai/core";
import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";

import { dedupe } from "./dedupe.js";
import {
  METRICS_DISCOVER_TOOL_INPUT_SCHEMA,
  QUERY_TOOL_INPUT_SCHEMA,
} from "./schema.js";

const RAW_SCHEMA = z.toJSONSchema(z.object({ query: kopaiQuery.KopaiQuery }), {
  io: "input",
}) as Record<string, unknown>;

// No `ajv-formats`: the generated document contains no `format` keyword at
// all — zod emits the ISO datetime constraint as a `pattern` — so a format
// library would add a dependency and validate nothing.
function compile(schema: Record<string, unknown>) {
  const ajv = new Ajv2020({ strict: false, allErrors: false });
  return ajv.compile(schema);
}

const td = { type: "relative", lookback: "1h" };

const VALID: Array<[string, unknown]> = [
  [
    "traces/aggregate minimal",
    {
      query: {
        signal: "traces",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "c" }],
        timeDimension: td,
        output: { type: "summary" },
      },
    },
  ],
  [
    "traces/aggregate timeSeries + dimensions + filters",
    {
      query: {
        signal: "traces",
        mode: "aggregate",
        measures: [{ op: "P95", column: "Duration", as: "p95" }],
        dimensions: ["service.name"],
        filters: [{ column: "StatusCode", op: "eq", value: "Error" }],
        timeDimension: td,
        output: { type: "timeSeries", granularity: "5m" },
        limit: 100,
      },
    },
  ],
  [
    "traces/aggregate nested logical filter",
    {
      query: {
        signal: "traces",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "c" }],
        filters: [
          {
            or: [
              { column: "service.name", op: "eq", value: "a" },
              {
                and: [
                  { column: "SpanName", op: "eq", value: "x" },
                  { column: "Duration", op: "gt", value: 5 },
                ],
              },
            ],
          },
        ],
        timeDimension: td,
        output: { type: "summary" },
      },
    },
  ],
  [
    "traces/aggregate in-filter + having + orderBy",
    {
      query: {
        signal: "traces",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "c" }],
        dimensions: ["SpanName"],
        filters: [
          { column: "SpanKind", op: "in", values: ["Server", "Client"] },
        ],
        havings: [{ measure: "c", op: "gt", value: 10 }],
        orderBy: [{ type: "measure", alias: "c", direction: "desc" }],
        timeDimension: td,
        output: { type: "summary" },
      },
    },
  ],
  [
    "traces/raw",
    {
      query: {
        signal: "traces",
        mode: "raw",
        dimensions: ["SpanId"],
        timeDimension: td,
      },
    },
  ],
  [
    "traces/raw attr-ref dimension",
    {
      query: {
        signal: "traces",
        mode: "raw",
        dimensions: [{ container: "SpanAttributes", key: "http.method" }],
        timeDimension: td,
        limit: 50,
      },
    },
  ],
  [
    "logs/aggregate",
    {
      query: {
        signal: "logs",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "n" }],
        timeDimension: td,
        output: { type: "summary" },
      },
    },
  ],
  [
    "logs/raw absolute window",
    {
      query: {
        signal: "logs",
        mode: "raw",
        dimensions: ["Body"],
        timeDimension: {
          type: "absolute",
          startTime: "2026-01-01T00:00:00Z",
          endTime: "2026-01-02T00:00:00Z",
        },
      },
    },
  ],
  [
    "metrics/aggregate",
    {
      query: {
        signal: "metrics",
        mode: "aggregate",
        measures: [{ op: "AVG", column: "Value", as: "v" }],
        filters: [{ column: "MetricType", op: "eq", value: "Gauge" }],
        timeDimension: td,
        output: { type: "summary" },
      },
    },
  ],
  [
    "metrics/raw",
    {
      query: {
        signal: "metrics",
        mode: "raw",
        dimensions: ["Value"],
        timeDimension: td,
      },
    },
  ],
];

const INVALID: Array<[string, unknown]> = [
  [
    "missing timeDimension",
    { query: { signal: "traces", mode: "raw", dimensions: ["SpanId"] } },
  ],
  [
    "unknown column",
    {
      query: {
        signal: "traces",
        mode: "raw",
        dimensions: ["NoSuchColumn"],
        timeDimension: td,
      },
    },
  ],
  [
    "wrong-signal column",
    {
      query: {
        signal: "logs",
        mode: "raw",
        dimensions: ["SpanKind"],
        timeDimension: td,
      },
    },
  ],
  [
    "unknown signal",
    { query: { signal: "events", mode: "raw", timeDimension: td } },
  ],
  ["missing mode", { query: { signal: "traces", timeDimension: td } }],
  [
    "limit 0",
    { query: { signal: "traces", mode: "raw", timeDimension: td, limit: 0 } },
  ],
  [
    "limit above the schema cap",
    {
      query: { signal: "traces", mode: "raw", timeDimension: td, limit: 20000 },
    },
  ],
  [
    "bad lookback",
    {
      query: {
        signal: "traces",
        mode: "raw",
        timeDimension: { type: "relative", lookback: "0h" },
      },
    },
  ],
  [
    "measure on the wrong signal",
    {
      query: {
        signal: "logs",
        mode: "aggregate",
        measures: [{ op: "P95", column: "Duration", as: "p" }],
        timeDimension: td,
        output: { type: "summary" },
      },
    },
  ],
  [
    "timeSeries without granularity",
    {
      query: {
        signal: "traces",
        mode: "aggregate",
        measures: [{ op: "COUNT", as: "c" }],
        timeDimension: td,
        output: { type: "timeSeries" },
      },
    },
  ],
  ["no query key", {}],
  ["query is not an object", { query: "hello" }],
];

describe("QUERY_TOOL_INPUT_SCHEMA", () => {
  it("has an object root, as MCP requires of a tool input schema", () => {
    expect(QUERY_TOOL_INPUT_SCHEMA.type).toBe("object");
  });

  it("compiles under a 2020-12 validator — every $ref resolves", () => {
    expect(() => compile(QUERY_TOOL_INPUT_SCHEMA)).not.toThrow();
  });

  it("is deduplicated into $defs and much smaller than the raw document", () => {
    const rawLen = JSON.stringify(RAW_SCHEMA).length;
    const outLen = JSON.stringify(QUERY_TOOL_INPUT_SCHEMA).length;
    expect(
      Object.keys(QUERY_TOOL_INPUT_SCHEMA.$defs ?? {}).length
    ).toBeGreaterThan(0);
    // Measured at 79.2%. Asserted loosely so that a schema change is not a
    // test failure, while a silent loss of deduplication still is.
    expect(outLen).toBeLessThan(rawLen * 0.5);
  });

  it("accepts every valid query the raw schema accepts", () => {
    const validate = compile(QUERY_TOOL_INPUT_SCHEMA);
    for (const [name, input] of VALID) {
      expect(validate(input), `${name} should be accepted`).toBe(true);
    }
  });

  it("rejects every invalid query the raw schema rejects", () => {
    const validate = compile(QUERY_TOOL_INPUT_SCHEMA);
    for (const [name, input] of INVALID) {
      expect(validate(input), `${name} should be rejected`).toBe(false);
    }
  });
});

describe("dedupe is lossless on the real query schema", () => {
  // The property the whole reduction rests on: the deduplicated document must
  // accept and reject exactly what the raw one does. A $ref pointing at the
  // wrong definition would still compile and would still look like a schema.
  const validateRaw = compile(RAW_SCHEMA);
  const validateDeduped = compile(dedupe(structuredClone(RAW_SCHEMA)));

  it("agrees with the raw schema on every hand-written case", () => {
    for (const [name, input] of [...VALID, ...INVALID]) {
      expect(validateDeduped(input), `disagreed on: ${name}`).toBe(
        validateRaw(input)
      );
    }
  });

  it("agrees with the raw schema across 4,000 mutated inputs", () => {
    const corpus = VALID.map(([, input]) => input);
    const pick = <T>(xs: T[]): T => {
      const chosen = xs[Math.floor(Math.random() * xs.length)];
      if (chosen === undefined) throw new Error("pick from an empty array");
      return chosen;
    };
    const disagreements: string[] = [];

    for (let i = 0; i < 4000; i++) {
      const mutated = structuredClone(pick(corpus)) as Record<string, unknown>;
      const sites: Array<[Record<string, unknown>, string]> = [];
      (function walk(x: unknown) {
        if (x && typeof x === "object") {
          for (const k of Object.keys(x as Record<string, unknown>)) {
            sites.push([x as Record<string, unknown>, k]);
            walk((x as Record<string, unknown>)[k]);
          }
        }
      })(mutated);
      if (sites.length === 0) continue;

      const [obj, key] = pick(sites);
      const roll = Math.random();
      if (roll < 0.35) delete obj[key];
      else if (roll < 0.7)
        obj[key] = pick([null, 0, -1, "zzz", [], {}, true, 99999] as unknown[]);
      else obj[`${key}_x`] = "extra";

      if (validateRaw(mutated) !== validateDeduped(mutated)) {
        disagreements.push(JSON.stringify(mutated).slice(0, 160));
      }
    }

    expect(disagreements).toEqual([]);
  });
});

describe("METRICS_DISCOVER_TOOL_INPUT_SCHEMA", () => {
  it("is an empty object schema that accepts an empty argument list", () => {
    const validate = compile(METRICS_DISCOVER_TOOL_INPUT_SCHEMA);
    expect(METRICS_DISCOVER_TOOL_INPUT_SCHEMA.type).toBe("object");
    expect(validate({})).toBe(true);
  });
});
