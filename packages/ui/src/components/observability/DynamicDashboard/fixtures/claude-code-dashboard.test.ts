import { describe, it, expect } from "vitest";
import { observabilityCatalog } from "@kopai/ui-core";
import { claudeCodeDashboard } from "./claude-code-dashboard.js";

describe("claudeCodeDashboard fixture", () => {
  it("parses against the observability catalog schema", () => {
    const result =
      observabilityCatalog.uiTreeSchema.safeParse(claudeCodeDashboard);
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it("every non-root element's parentKey references a real element", () => {
    const elements = claudeCodeDashboard.elements as Record<
      string,
      { parentKey: string; children: string[] }
    >;
    for (const [key, el] of Object.entries(elements)) {
      if (key === claudeCodeDashboard.root) continue;
      expect(elements[el.parentKey]).toBeDefined();
    }
  });

  it("every child key referenced in `children` exists", () => {
    const elements = claudeCodeDashboard.elements as Record<
      string,
      { parentKey: string; children: string[] }
    >;
    for (const el of Object.values(elements)) {
      for (const childKey of el.children) {
        expect(elements[childKey]).toBeDefined();
      }
    }
  });
});
