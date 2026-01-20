import type { FastifySchemaValidationError } from "fastify";
import type { FieldViolation } from "./otlp-schemas.js";

export function extractLeafError(errors: unknown[][]): {
  path: (string | number)[];
  message: string;
  expected?: string;
} {
  for (const branch of errors) {
    if (!Array.isArray(branch) || !branch.length) continue;
    const e = branch[0] as {
      code?: string;
      path?: (string | number)[];
      message?: string;
      expected?: string;
      errors?: unknown[][];
    };
    if (e?.code === "invalid_union" && e.errors) {
      const deeper = extractLeafError(e.errors);
      return {
        path: [...(e.path || []), ...deeper.path],
        message: deeper.message,
        expected: deeper.expected,
      };
    }
    return {
      path: e?.path || [],
      message: e?.message || "Validation failed",
      expected: e?.expected,
    };
  }
  return { path: [], message: "Validation failed" };
}

export function toFieldViolation(
  error: FastifySchemaValidationError
): FieldViolation {
  let field = error.instancePath.replace(/^\//, "").replace(/\//g, ".") || "";
  let description = error.message ?? "Validation failed";

  if (error.keyword === "invalid_union" && error.params?.errors) {
    const leaf = extractLeafError(error.params.errors as unknown[][]);
    const leafPath = leaf.path
      .map((p) => (typeof p === "number" ? `[${p}]` : `.${p}`))
      .join("")
      .replace(/^\./, "");
    if (leafPath) {
      const sep = leafPath.startsWith("[") ? "" : ".";
      field = field ? `${field}${sep}${leafPath}` : leafPath;
    }
    description = leaf.expected ? `expected ${leaf.expected}` : leaf.message;
  }

  return { field: field || "unknown", description, reason: error.keyword };
}
