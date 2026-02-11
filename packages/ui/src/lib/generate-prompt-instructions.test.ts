import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createCatalog } from "./component-catalog.js";
import { generatePromptInstructions } from "./generate-prompt-instructions.js";

describe("generatePromptInstructions", () => {
  it("generates full prompt instructions", () => {
    const catalog = createCatalog({
      name: "test",
      components: {
        Card: {
          props: z.object({ title: z.string() }),
          description: "A card container",
          hasChildren: true,
        },
        Button: {
          props: z.object({ label: z.string() }),
          description: "Clickable button",
          hasChildren: false,
        },
      },
    });

    const prompt = generatePromptInstructions(catalog);
    expect(prompt).toMatchSnapshot();
  });
});
