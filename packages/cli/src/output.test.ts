import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseFields, output, detectFormat } from "./output.js";

describe("parseFields", () => {
  it("returns undefined for undefined input", () => {
    expect(parseFields(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseFields("")).toBeUndefined();
  });

  it("parses single field", () => {
    expect(parseFields("name")).toEqual(["name"]);
  });

  it("parses multiple comma-separated fields", () => {
    expect(parseFields("name,id,status")).toEqual(["name", "id", "status"]);
  });

  it("trims whitespace from fields", () => {
    expect(parseFields(" name , id , status ")).toEqual([
      "name",
      "id",
      "status",
    ]);
  });
});

describe("detectFormat", () => {
  it("returns json when json flag is true", () => {
    expect(detectFormat(true, false)).toBe("json");
  });

  it("returns table when table flag is true", () => {
    expect(detectFormat(false, true)).toBe("table");
  });

  it("prefers json over table when both are true", () => {
    expect(detectFormat(true, true)).toBe("json");
  });
});

describe("output with fields", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "table").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters array of objects to specified fields (JSON)", () => {
    const data = [
      { id: 1, name: "foo", extra: "x" },
      { id: 2, name: "bar", extra: "y" },
    ];

    output(data, { format: "json", fields: ["id", "name"] });

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify(
        [
          { id: 1, name: "foo" },
          { id: 2, name: "bar" },
        ],
        null,
        2
      )
    );
  });

  it("filters array of objects to specified fields (table)", () => {
    const data = [
      { id: 1, name: "foo", extra: "x" },
      { id: 2, name: "bar", extra: "y" },
    ];

    output(data, { format: "table", fields: ["id", "name"] });

    expect(console.table).toHaveBeenCalledWith([
      { id: 1, name: "foo" },
      { id: 2, name: "bar" },
    ]);
  });

  it("filters single object to specified fields", () => {
    const data = { id: 1, name: "foo", extra: "x" };

    output(data, { format: "json", fields: ["name"] });

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({ name: "foo" }, null, 2)
    );
  });

  it("passes through non-object array items unchanged", () => {
    const data = [1, 2, 3];

    output(data, { format: "json", fields: ["id"] });

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify([1, 2, 3], null, 2)
    );
  });

  it("works with empty fields array (no filtering)", () => {
    const data = [{ id: 1, name: "foo" }];

    output(data, { format: "json", fields: [] });

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify([{ id: 1, name: "foo" }], null, 2)
    );
  });

  it("works without fields option (no filtering)", () => {
    const data = [{ id: 1, name: "foo" }];

    output(data, { format: "json" });

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify([{ id: 1, name: "foo" }], null, 2)
    );
  });
});
