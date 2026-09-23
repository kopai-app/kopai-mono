/// <reference types="vitest/globals" />
import { applyDescriptions, type DescriptionOverride } from "./describe.js";
import { LIMITS } from "./limits.js";
import {
  DESCRIPTION_OVERRIDES_APPLIED,
  QUERY_TOOL_INPUT_SCHEMA,
} from "./schema.js";

function descriptionsIn(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach((n) => descriptionsIn(n, out));
    return out;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.description === "string") out.push(record.description);
  Object.values(record).forEach((v) => descriptionsIn(v, out));
  return out;
}

describe("applyDescriptions", () => {
  const overrides: DescriptionOverride[] = [
    { prefix: "Keep.", mode: "append", text: " Extended." },
    { prefix: "Swap.", mode: "replace", text: "Replaced." },
  ];

  it("appends and replaces by prefix, wherever the node sits", () => {
    const { document, applied } = applyDescriptions(
      {
        description: "Swap. Original.",
        properties: {
          a: { description: "Keep. Original." },
          b: { items: { description: "Keep. Also." } },
          c: { description: "Untouched." },
        },
      },
      overrides
    );
    const props = document.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(document.description).toBe("Replaced.");
    expect(props.a?.description).toBe("Keep. Original. Extended.");
    expect((props.b?.items as Record<string, unknown>).description).toBe(
      "Keep. Also. Extended."
    );
    expect(props.c?.description).toBe("Untouched.");
    expect(applied).toEqual({ "Keep.": 2, "Swap.": 1 });
  });

  it("reports zero for an override that matched nothing", () => {
    const { applied } = applyDescriptions({ description: "Other." }, overrides);
    expect(applied).toEqual({ "Keep.": 0, "Swap.": 0 });
  });

  it("does not mutate the document it is given", () => {
    const original = { description: "Swap. Original." };
    applyDescriptions(original, overrides);
    expect(original.description).toBe("Swap. Original.");
  });
});

describe("the advertised schema's guidance", () => {
  // If the shared schema is reworded, these fail rather than silently
  // shipping a tool that no longer explains its own limits.
  it("applies every override somewhere", () => {
    for (const [prefix, count] of Object.entries(
      DESCRIPTION_OVERRIDES_APPLIED
    )) {
      expect(count, `override "${prefix}" matched nothing`).toBeGreaterThan(0);
    }
  });

  it("covers the aggregate `dimensions` of all three signals", () => {
    expect(DESCRIPTION_OVERRIDES_APPLIED["GROUP BY columns."]).toBe(3);
  });

  const all = () => descriptionsIn(QUERY_TOOL_INPUT_SCHEMA);

  it("no longer advertises REST's cap, which this tool does not honour", () => {
    expect(all().join(" ")).not.toContain("Hard cap = 10000");
  });

  it("states the caps this tool actually enforces", () => {
    const limit = all().find((d) => d.startsWith("Maximum rows to return."));
    expect(limit).toContain(String(LIMITS.raw.max));
    expect(limit).toContain(String(LIMITS.aggregate.max));
    expect(limit).toMatch(/refuses/);
  });

  it("ties granularity to the row count", () => {
    const granularity = all().find((d) => d.startsWith("Bucket width."));
    expect(granularity).toMatch(/one row per group per bucket/);
  });

  it("warns that a high-cardinality grouping can overrun on its own", () => {
    const dimensions = all().find((d) => d.startsWith("GROUP BY columns."));
    expect(dimensions).toMatch(/cardinality/);
    expect(dimensions).toMatch(/multiplied by the bucket count/);
  });
});
