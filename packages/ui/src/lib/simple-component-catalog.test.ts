import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  dataSourceSchema,
  createSimpleCatalog,
} from "./simple-component-catalog.js";

describe("schemas", () => {
  it("datasource", () => {
    expect.assertions(0);
    type DataSource = z.infer<typeof dataSourceSchema>;

    const _testDataSource1 = {
      method: "searchTracesPage",
      params: {
        // @ts-expect-error - invalid param
        nonExisting: "",
      },
    } satisfies DataSource;

    const _testDataSource2 = {
      method: "searchTracesPage",
      params: {
        cursor: "test",
        eventsAttributes: {
          foo: "bar",
        },
        limit: 3,
      },
    } satisfies DataSource;
  });

  describe("createSimpleCatalog", () => {
    it("creates uiTreeSchema that validates component props", () => {
      const catalog = createSimpleCatalog({
        name: "test catalog",
        components: {
          TestComponent: {
            description: "test",
            hasChildren: false,
            props: z.object({ isImportant: z.boolean() }),
          },
        },
      });

      // Valid data passes
      const validResult = catalog.uiTreeSchema.safeParse({
        root: "test-1",
        elements: {
          TestComponent: {
            key: "test-1",
            type: "TestComponent",
            children: [],
            parentKey: "",
            props: { isImportant: true },
          },
        },
      });
      expect(validResult.success).toBe(true);

      // Invalid props fail
      const invalidResult = catalog.uiTreeSchema.safeParse({
        root: "test-1",
        elements: {
          TestComponent: {
            key: "test-1",
            type: "TestComponent",
            children: [],
            parentKey: "",
            props: { isImportant: "not-a-boolean" },
          },
        },
      });
      expect(invalidResult.success).toBe(false);
    });

    it("returns components with exact types from config", () => {
      expect.assertions(0);

      const catalog = createSimpleCatalog({
        name: "test catalog",
        components: {
          TestComponent: {
            description: "test",
            hasChildren: false,
            props: z.object({ isImportant: z.boolean() }),
          },
        },
      });

      // Valid: accessing defined component
      const _validAccess = catalog.components.TestComponent;

      // @ts-expect-error - non-existent component
      const _invalidAccess = catalog.components.NonExistentComponent;

      // Props type preserved - can infer schema type
      type Props = z.infer<typeof catalog.components.TestComponent.props>;
      const _validProps: Props = { isImportant: true };
      // @ts-expect-error - wrong prop type
      const _invalidProps: Props = { isImportant: "not-boolean" };
      // @ts-expect-error - non-existent prop
      const _missingProps: Props = { nonExistent: true };
    });

    it("validates multiple components with dataSource", () => {
      const catalog = createSimpleCatalog({
        name: "multi catalog",
        components: {
          Button: {
            description: "button",
            hasChildren: false,
            props: z.object({ label: z.string() }),
          },
          Card: {
            description: "card",
            hasChildren: true,
            props: z.object({ title: z.string(), bordered: z.boolean() }),
          },
        },
      });

      expect(catalog.name).toBe("multi catalog");

      // Valid with dataSource
      const validResult = catalog.uiTreeSchema.safeParse({
        root: "card-1",
        elements: {
          Card: {
            key: "card-1",
            type: "Card",
            children: ["btn-1"],
            parentKey: "",
            props: { title: "Hello", bordered: true },
            dataSource: {
              method: "searchTracesPage",
              params: { limit: 10 },
            },
          },
          Button: {
            key: "btn-1",
            type: "Button",
            children: [],
            parentKey: "card-1",
            props: { label: "Click" },
          },
        },
      });
      expect(validResult.success).toBe(true);

      // Invalid dataSource params
      const invalidDataSource = catalog.uiTreeSchema.safeParse({
        root: "btn-1",
        elements: {
          Button: {
            key: "btn-1",
            type: "Button",
            children: [],
            parentKey: "",
            props: { label: "Click" },
            dataSource: {
              method: "searchTracesPage",
              params: { invalidParam: true },
            },
          },
        },
      });
      expect(invalidDataSource.success).toBe(false);
    });

    it("types multiple components correctly", () => {
      expect.assertions(0);

      const catalog = createSimpleCatalog({
        name: "multi catalog",
        components: {
          Button: {
            description: "button",
            hasChildren: false,
            props: z.object({ label: z.string() }),
          },
          Card: {
            description: "card",
            hasChildren: true,
            props: z.object({ title: z.string() }),
          },
        },
      });

      // Both components accessible
      const _button = catalog.components.Button;
      const _card = catalog.components.Card;

      // @ts-expect-error - non-existent
      const _missing = catalog.components.Missing;

      // Props types preserved per component
      type ButtonProps = z.infer<typeof catalog.components.Button.props>;
      type CardProps = z.infer<typeof catalog.components.Card.props>;

      const _validButton: ButtonProps = { label: "hi" };
      const _validCard: CardProps = { title: "hi" };

      // @ts-expect-error - wrong component props
      const _wrongButton: ButtonProps = { title: "hi" };
      // @ts-expect-error - wrong component props
      const _wrongCard: CardProps = { label: "hi" };
    });

    it("types uiTreeSchema elements with dataSource", () => {
      expect.assertions(0);

      const _catalog = createSimpleCatalog({
        name: "test catalog",
        components: {
          Button: {
            description: "button",
            hasChildren: false,
            props: z.object({ label: z.string() }),
          },
          Card: {
            description: "card",
            hasChildren: true,
            props: z.object({ title: z.string() }),
          },
        },
      });

      type UiTree = z.infer<typeof _catalog.uiTreeSchema>;

      // Valid: elements with dataSource
      const _validTree: UiTree = {
        root: "card-1",
        elements: {
          Card: {
            key: "card-1",
            type: "Card",
            children: ["btn-1"],
            parentKey: "",
            props: { title: "Hello" },
            dataSource: {
              method: "searchTracesPage",
              params: { limit: 10 },
            },
          },
          Button: {
            key: "btn-1",
            type: "Button",
            children: [],
            parentKey: "card-1",
            props: { label: "Click" },
          },
        },
      };

      const _invalidKey: UiTree = {
        root: "x",
        elements: {
          // @ts-expect-error - non-existent element key
          NonExistent: {
            key: "x",
            type: "x",
            children: [],
            parentKey: "",
            props: {},
          },
        },
      };

      const _invalidProps: UiTree = {
        root: "btn-1",
        elements: {
          Button: {
            key: "btn-1",
            type: "Button",
            children: [],
            parentKey: "",
            // @ts-expect-error - wrong props type for element
            props: { title: "wrong prop" },
          },
        },
      };

      const _invalidDataSource: UiTree = {
        root: "btn-1",
        elements: {
          Button: {
            key: "btn-1",
            type: "Button",
            children: [],
            parentKey: "",
            props: { label: "Click" },
            dataSource: {
              // @ts-expect-error - invalid dataSource method
              method: "invalidMethod",
              params: {},
            },
          },
        },
      };

      const _invalidDataSourceParams: UiTree = {
        root: "btn-1",
        elements: {
          Button: {
            key: "btn-1",
            type: "Button",
            children: [],
            parentKey: "",
            props: { label: "Click" },
            dataSource: {
              method: "searchTracesPage",
              // @ts-expect-error - invalid params for searchTracesPage
              params: { foo: 1 },
            },
          },
        },
      };
    });
  });
});
