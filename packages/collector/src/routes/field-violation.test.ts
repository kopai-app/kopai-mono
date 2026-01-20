/// <reference types="vitest/globals" />
import { toFieldViolation, extractLeafError } from "./field-violation.js";

describe("extractLeafError", () => {
  it("returns default when errors array is empty", () => {
    expect(extractLeafError([])).toEqual({
      path: [],
      message: "Validation failed",
    });
  });

  it("skips non-array branches", () => {
    expect(
      extractLeafError([null as unknown as unknown[], [{ message: "found" }]])
    ).toEqual({
      path: [],
      message: "found",
      expected: undefined,
    });
  });

  it("skips empty branches", () => {
    expect(extractLeafError([[], [{ message: "found" }]])).toEqual({
      path: [],
      message: "found",
      expected: undefined,
    });
  });

  it("returns leaf error with path, message, expected", () => {
    expect(
      extractLeafError([
        [{ path: ["foo", 0], message: "bad", expected: "string" }],
      ])
    ).toEqual({
      path: ["foo", 0],
      message: "bad",
      expected: "string",
    });
  });

  it("returns default message when leaf has no message", () => {
    expect(extractLeafError([[{ path: ["x"] }]])).toEqual({
      path: ["x"],
      message: "Validation failed",
      expected: undefined,
    });
  });

  it("returns empty path when leaf has no path", () => {
    expect(extractLeafError([[{ message: "err" }]])).toEqual({
      path: [],
      message: "err",
      expected: undefined,
    });
  });

  it("recurses into nested invalid_union", () => {
    const nested = [
      [
        {
          code: "invalid_union",
          path: ["a"],
          errors: [[{ path: ["b"], message: "leaf", expected: "number" }]],
        },
      ],
    ];
    expect(extractLeafError(nested)).toEqual({
      path: ["a", "b"],
      message: "leaf",
      expected: "number",
    });
  });

  it("handles deeply nested unions", () => {
    const deep = [
      [
        {
          code: "invalid_union",
          path: [0],
          errors: [
            [
              {
                code: "invalid_union",
                path: ["x"],
                errors: [[{ path: [1], message: "deep", expected: "boolean" }]],
              },
            ],
          ],
        },
      ],
    ];
    expect(extractLeafError(deep)).toEqual({
      path: [0, "x", 1],
      message: "deep",
      expected: "boolean",
    });
  });

  it("handles union with no path", () => {
    const nested = [
      [{ code: "invalid_union", errors: [[{ message: "inner" }]] }],
    ];
    expect(extractLeafError(nested)).toEqual({
      path: [],
      message: "inner",
      expected: undefined,
    });
  });
});

describe("toFieldViolation", () => {
  it("converts simple error with message", () => {
    expect(
      toFieldViolation({
        instancePath: "/foo/bar",
        keyword: "type",
        message: "must be string",
        schemaPath: "",
        params: {},
      })
    ).toEqual({
      field: "foo.bar",
      description: "must be string",
      reason: "type",
    });
  });

  it("uses 'Validation failed' when message is undefined", () => {
    expect(
      toFieldViolation({
        instancePath: "/x",
        keyword: "required",
        message: undefined,
        schemaPath: "",
        params: {},
      })
    ).toEqual({
      field: "x",
      description: "Validation failed",
      reason: "required",
    });
  });

  it("uses 'unknown' when field is empty", () => {
    expect(
      toFieldViolation({
        instancePath: "",
        keyword: "type",
        message: "bad",
        schemaPath: "",
        params: {},
      })
    ).toEqual({
      field: "unknown",
      description: "bad",
      reason: "type",
    });
  });

  it("handles invalid_union with leaf path starting with property", () => {
    expect(
      toFieldViolation({
        instancePath: "/root",
        keyword: "invalid_union",
        message: "Invalid input",
        schemaPath: "",
        params: {
          errors: [[{ path: ["prop"], message: "err" }]],
        },
      })
    ).toEqual({
      field: "root.prop",
      description: "err",
      reason: "invalid_union",
    });
  });

  it("handles invalid_union with leaf path starting with index", () => {
    expect(
      toFieldViolation({
        instancePath: "/items",
        keyword: "invalid_union",
        message: "Invalid input",
        schemaPath: "",
        params: {
          errors: [[{ path: [0, "name"], message: "err" }]],
        },
      })
    ).toEqual({
      field: "items[0].name",
      description: "err",
      reason: "invalid_union",
    });
  });

  it("handles invalid_union with empty instancePath and property leaf", () => {
    expect(
      toFieldViolation({
        instancePath: "",
        keyword: "invalid_union",
        message: "Invalid input",
        schemaPath: "",
        params: {
          errors: [[{ path: ["field"], message: "err" }]],
        },
      })
    ).toEqual({
      field: "field",
      description: "err",
      reason: "invalid_union",
    });
  });

  it("handles invalid_union with empty instancePath and index leaf", () => {
    expect(
      toFieldViolation({
        instancePath: "",
        keyword: "invalid_union",
        message: "Invalid input",
        schemaPath: "",
        params: {
          errors: [[{ path: [0], message: "err" }]],
        },
      })
    ).toEqual({
      field: "[0]",
      description: "err",
      reason: "invalid_union",
    });
  });

  it("uses expected when present", () => {
    expect(
      toFieldViolation({
        instancePath: "/x",
        keyword: "invalid_union",
        message: "Invalid input",
        schemaPath: "",
        params: {
          errors: [[{ path: ["y"], expected: "number" }]],
        },
      })
    ).toEqual({
      field: "x.y",
      description: "expected number",
      reason: "invalid_union",
    });
  });

  it("uses leaf message when expected is absent", () => {
    expect(
      toFieldViolation({
        instancePath: "/x",
        keyword: "invalid_union",
        message: "Invalid input",
        schemaPath: "",
        params: {
          errors: [[{ path: ["y"], message: "custom msg" }]],
        },
      })
    ).toEqual({
      field: "x.y",
      description: "custom msg",
      reason: "invalid_union",
    });
  });

  it("handles invalid_union with no leafPath (empty path)", () => {
    expect(
      toFieldViolation({
        instancePath: "/root",
        keyword: "invalid_union",
        message: "Invalid input",
        schemaPath: "",
        params: {
          errors: [[{ path: [], message: "no path" }]],
        },
      })
    ).toEqual({
      field: "root",
      description: "no path",
      reason: "invalid_union",
    });
  });

  it("returns unknown when invalid_union has no leafPath and empty instancePath", () => {
    expect(
      toFieldViolation({
        instancePath: "",
        keyword: "invalid_union",
        message: "Invalid input",
        schemaPath: "",
        params: {
          errors: [[{ path: [], message: "no path" }]],
        },
      })
    ).toEqual({
      field: "unknown",
      description: "no path",
      reason: "invalid_union",
    });
  });

  it("handles non-union keyword even if params.errors exists", () => {
    expect(
      toFieldViolation({
        instancePath: "/foo",
        keyword: "type",
        message: "wrong type",
        schemaPath: "",
        params: { errors: [[{ path: ["ignored"] }]] },
      })
    ).toEqual({
      field: "foo",
      description: "wrong type",
      reason: "type",
    });
  });

  it("handles invalid_union without params.errors", () => {
    expect(
      toFieldViolation({
        instancePath: "/foo",
        keyword: "invalid_union",
        message: "union fail",
        schemaPath: "",
        params: {},
      })
    ).toEqual({
      field: "foo",
      description: "union fail",
      reason: "invalid_union",
    });
  });
});
