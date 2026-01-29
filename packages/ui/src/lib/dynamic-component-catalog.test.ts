import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createCatalog } from "./dynamic-component-catalog.js";

describe("createCatalog", () => {
  it("creates catalog with name, components, actions", () => {
    const catalog = createCatalog({
      name: "test-catalog",
      components: {
        Button: { props: z.object({ label: z.string() }) },
      },
      actions: {
        click: { params: z.object({ target: z.string() }) },
      },
    });

    expect(catalog.name).toBe("test-catalog");
    expect(catalog.components).toHaveProperty("Button");
    expect(catalog.actions).toHaveProperty("click");
  });

  it("returns correct componentNames and actionNames", () => {
    const catalog = createCatalog({
      components: {
        Button: { props: z.object({ label: z.string() }) },
        Input: { props: z.object({ placeholder: z.string() }) },
      },
      actions: {
        click: {},
        submit: {},
      },
    });

    expect(catalog.componentNames).toEqual(["Button", "Input"]);
    expect(catalog.actionNames).toEqual(["click", "submit"]);
  });

  it("uses default name when not provided", () => {
    const catalog = createCatalog({
      components: {},
    });

    expect(catalog.name).toBe("unnamed");
  });

  it("handles empty components/actions", () => {
    const catalog = createCatalog({
      components: {},
      actions: {},
    });

    expect(catalog.componentNames).toEqual([]);
    expect(catalog.actionNames).toEqual([]);
  });
});

describe("catalog methods", () => {
  const catalog = createCatalog({
    components: {
      Button: { props: z.object({ label: z.string() }) },
      Text: { props: z.object({ content: z.string() }) },
    },
    actions: {
      click: {},
      navigate: { params: z.object({ url: z.string() }) },
    },
  });

  describe("hasComponent", () => {
    it("returns true for existing component", () => {
      expect(catalog.hasComponent("Button")).toBe(true);
      expect(catalog.hasComponent("Text")).toBe(true);
    });

    it("returns false for non-existing component", () => {
      expect(catalog.hasComponent("NonExistent")).toBe(false);
    });
  });

  describe("hasAction", () => {
    it("returns true for existing action", () => {
      expect(catalog.hasAction("click")).toBe(true);
      expect(catalog.hasAction("navigate")).toBe(true);
    });

    it("returns false for non-existing action", () => {
      expect(catalog.hasAction("nonExistent")).toBe(false);
    });
  });

  describe("validateElement", () => {
    it("validates correct element", () => {
      const result = catalog.validateElement({
        key: "btn-1",
        type: "Button",
        props: { label: "Click me" },
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        key: "btn-1",
        type: "Button",
        props: { label: "Click me" },
      });
    });

    it("validates element with children", () => {
      const result = catalog.validateElement({
        key: "btn-1",
        type: "Button",
        props: { label: "Click me" },
        children: ["child-1", "child-2"],
        parentKey: "root",
      });

      expect(result.success).toBe(true);
    });

    it("fails for invalid component type", () => {
      const result = catalog.validateElement({
        key: "el-1",
        type: "NonExistent",
        props: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("fails for invalid props", () => {
      const result = catalog.validateElement({
        key: "btn-1",
        type: "Button",
        props: { label: 123 }, // should be string
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("fails for missing required props", () => {
      const result = catalog.validateElement({
        key: "btn-1",
        type: "Button",
        props: {}, // missing label
      });

      expect(result.success).toBe(false);
    });
  });

  describe("validateTree", () => {
    it("validates correct tree", () => {
      const result = catalog.validateTree({
        root: "root-1",
        elements: {
          "root-1": {
            key: "root-1",
            type: "Button",
            props: { label: "Root" },
            children: ["child-1"],
            parentKey: null,
          },
          "child-1": {
            key: "child-1",
            type: "Text",
            props: { content: "Hello" },
            parentKey: "root-1",
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("fails for invalid tree structure", () => {
      const result = catalog.validateTree({
        root: 123, // should be string
        elements: {},
      });

      expect(result.success).toBe(false);
    });

    it("fails for invalid element in tree", () => {
      const result = catalog.validateTree({
        root: "root-1",
        elements: {
          "root-1": {
            key: "root-1",
            type: "Button",
            props: { label: 123 }, // invalid
          },
        },
      });

      expect(result.success).toBe(false);
    });
  });
});

describe("schema generation", () => {
  describe("elementSchema", () => {
    it("validates component elements", () => {
      const catalog = createCatalog({
        components: {
          Card: { props: z.object({ title: z.string() }) },
        },
      });

      const result = catalog.elementSchema.safeParse({
        key: "card-1",
        type: "Card",
        props: { title: "My Card" },
      });

      expect(result.success).toBe(true);
    });
  });

  describe("treeSchema", () => {
    it("validates full UI tree structure", () => {
      const catalog = createCatalog({
        components: {
          Container: { props: z.object({ padding: z.number() }) },
        },
      });

      const result = catalog.treeSchema.safeParse({
        root: "container-1",
        elements: {
          "container-1": {
            key: "container-1",
            type: "Container",
            props: { padding: 16 },
          },
        },
      });

      expect(result.success).toBe(true);
    });
  });

  describe("discriminated union", () => {
    it("works with multiple component types", () => {
      const catalog = createCatalog({
        components: {
          Button: { props: z.object({ label: z.string() }) },
          Input: { props: z.object({ placeholder: z.string() }) },
          Text: { props: z.object({ content: z.string() }) },
        },
      });

      // Each type should have its own validation
      const btnResult = catalog.validateElement({
        key: "btn-1",
        type: "Button",
        props: { label: "Click" },
      });
      expect(btnResult.success).toBe(true);

      const inputResult = catalog.validateElement({
        key: "input-1",
        type: "Input",
        props: { placeholder: "Enter text" },
      });
      expect(inputResult.success).toBe(true);

      // Wrong props for type should fail
      const wrongPropsResult = catalog.validateElement({
        key: "btn-2",
        type: "Button",
        props: { placeholder: "Wrong prop" }, // Button needs label, not placeholder
      });
      expect(wrongPropsResult.success).toBe(false);
    });
  });
});

describe("edge cases", () => {
  describe("empty components array", () => {
    it("creates fallback schema that accepts any element", () => {
      const catalog = createCatalog({
        components: {},
      });

      const result = catalog.validateElement({
        key: "el-1",
        type: "AnyType",
        props: { any: "props" },
      });

      expect(result.success).toBe(true);
    });
  });

  describe("single component", () => {
    it("creates schema without union", () => {
      const catalog = createCatalog({
        components: {
          Solo: { props: z.object({ value: z.number() }) },
        },
      });

      const validResult = catalog.validateElement({
        key: "solo-1",
        type: "Solo",
        props: { value: 42 },
      });
      expect(validResult.success).toBe(true);

      const invalidResult = catalog.validateElement({
        key: "solo-2",
        type: "Other",
        props: { value: 42 },
      });
      expect(invalidResult.success).toBe(false);
    });
  });

  describe("multiple components", () => {
    it("creates discriminated union schema", () => {
      const catalog = createCatalog({
        components: {
          A: { props: z.object({ a: z.string() }) },
          B: { props: z.object({ b: z.number() }) },
          C: { props: z.object({ c: z.boolean() }) },
        },
      });

      expect(
        catalog.validateElement({ key: "1", type: "A", props: { a: "str" } })
          .success
      ).toBe(true);
      expect(
        catalog.validateElement({ key: "2", type: "B", props: { b: 123 } })
          .success
      ).toBe(true);
      expect(
        catalog.validateElement({ key: "3", type: "C", props: { c: true } })
          .success
      ).toBe(true);

      // Cross-type validation should fail
      expect(
        catalog.validateElement({ key: "4", type: "A", props: { b: 123 } })
          .success
      ).toBe(false);
    });
  });
});
