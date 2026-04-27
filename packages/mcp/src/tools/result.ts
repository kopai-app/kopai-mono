import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function jsonResult(structured: object): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(structured) }],
    structuredContent: structured as Record<string, unknown>,
  };
}
