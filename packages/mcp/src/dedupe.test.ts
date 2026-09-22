/// <reference types="vitest/globals" />
import { dedupe } from "./dedupe.js";

describe("dedupe", () => {
  it("hoists a repeated subschema and references it from both sites", () => {
    const repeated = {
      type: "string",
      enum: ["alpha", "beta", "gamma"],
      description: "A column name, repeated across two properties.",
    };
    const doc = dedupe({
      type: "object",
      properties: { a: { ...repeated }, b: { ...repeated } },
    });

    const defs = doc.$defs as Record<string, unknown>;
    const names = Object.keys(defs);
    expect(names).toHaveLength(1);
    const name = String(names[0]);
    expect(defs[name]).toEqual(repeated);

    const props = doc.properties as Record<string, unknown>;
    expect(props.a).toEqual({ $ref: `#/$defs/${name}` });
    expect(props.b).toEqual({ $ref: `#/$defs/${name}` });
  });

  it("leaves a subschema that occurs once alone", () => {
    const doc = dedupe({
      type: "object",
      properties: {
        a: { type: "string", description: "x".repeat(80) },
        b: { type: "number", description: "y".repeat(80) },
      },
    });
    expect(doc.$defs).toEqual({});
  });

  it("leaves repeats below minLen alone — a $ref would cost more", () => {
    const doc = dedupe({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
    });
    expect(doc.$defs).toEqual({});
  });

  it("does not hoist out of `enum`, which holds data and not schemas", () => {
    // Both enum members serialize identically and are long enough to tempt a
    // blind object walk. Hoisting one would change what the document accepts.
    const member = { kind: "literal", value: "a-long-enough-payload-here-ok" };
    const doc = dedupe({
      type: "object",
      enum: [{ ...member }, { ...member }],
    });
    expect(doc.$defs).toEqual({});
    expect(doc.enum).toEqual([member, member]);
  });

  it("descends into every keyword where a schema may legally appear", () => {
    const repeated = {
      type: "string",
      pattern: "^[a-z]+$",
      description: "long enough to be worth hoisting into a definition",
    };
    const doc = dedupe({
      type: "object",
      properties: { a: { ...repeated } },
      items: { ...repeated },
      anyOf: [{ ...repeated }],
      additionalProperties: { ...repeated },
    });
    const defs = doc.$defs as Record<string, unknown>;
    expect(Object.keys(defs)).toHaveLength(1);
    const ref = { $ref: `#/$defs/${String(Object.keys(defs)[0])}` };
    expect((doc.properties as Record<string, unknown>).a).toEqual(ref);
    expect(doc.items).toEqual(ref);
    expect((doc.anyOf as unknown[])[0]).toEqual(ref);
    expect(doc.additionalProperties).toEqual(ref);
  });

  it("keeps a definition from becoming a reference to itself", () => {
    const repeated = {
      type: "string",
      description: "repeated in the body and also already a definition",
    };
    const doc = dedupe({
      type: "object",
      properties: { a: { ...repeated }, b: { ...repeated } },
      $defs: {
        existing: { type: "object", properties: { c: { ...repeated } } },
      },
    });
    const defs = doc.$defs as Record<string, Record<string, unknown>>;
    // The hoisted body is the schema itself, never a $ref back to its own name.
    const hoisted = Object.entries(defs).find(([n]) => n !== "existing");
    expect(hoisted).toBeDefined();
    expect(hoisted?.[1]).toEqual(repeated);
    expect(JSON.stringify(defs.existing)).toContain("$ref");
  });

  it("preserves an existing $defs entry", () => {
    const doc = dedupe({
      type: "object",
      $defs: { kept: { type: "integer" } },
      properties: { a: { $ref: "#/$defs/kept" } },
    });
    expect((doc.$defs as Record<string, unknown>).kept).toEqual({
      type: "integer",
    });
  });
});
