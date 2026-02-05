import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { createRegistry } from "./create-registry.js";
import { type RendererComponentProps } from "./simple-renderer.js";
import { createSimpleCatalog } from "./simple-component-catalog.js";
import z from "zod";

describe("createRegistry", () => {
  // Create a catalog for registry tests
  const registryCatalog = createSimpleCatalog({
    name: "registry-test",
    components: {
      Button: {
        hasChildren: false,
        description: "A button",
        props: z.object({ label: z.string() }),
      },
      Container: {
        hasChildren: true,
        description: "A container",
        props: z.object({ padding: z.number() }),
      },
    },
  });

  it("creates registry with correct component types", () => {
    expect.assertions(0);

    // Valid: all components provided with correct props
    function Button({
      element,
    }: RendererComponentProps<typeof registryCatalog.components.Button>) {
      return createElement("button", null, element.props.label);
    }

    function Container({
      element,
      children,
    }: RendererComponentProps<typeof registryCatalog.components.Container>) {
      return createElement(
        "div",
        { style: { padding: element.props.padding } },
        children
      );
    }

    const _registry = createRegistry(registryCatalog, {
      Button,
      Container,
    });
  });

  it("errors when catalog component is missing", () => {
    expect.assertions(0);

    function Button({
      element,
    }: RendererComponentProps<typeof registryCatalog.components.Button>) {
      return createElement("button", null, element.props.label);
    }

    // @ts-expect-error - Container is missing from registry
    const _registry = createRegistry(registryCatalog, {
      Button,
    });
  });

  it("errors when component has wrong props type", () => {
    expect.assertions(0);

    // Wrong props - expects { label: string } but gets { title: string }
    function Button({ element }: { element: { props: { title: string } } }) {
      return createElement("button", null, element.props.title);
    }

    function Container({
      element,
      children,
    }: RendererComponentProps<typeof registryCatalog.components.Container>) {
      return createElement(
        "div",
        { style: { padding: element.props.padding } },
        children
      );
    }

    const _registry = createRegistry(registryCatalog, {
      // @ts-expect-error - Button has wrong props type
      Button,
      Container,
    });
  });

  it("errors when extra component is provided", () => {
    expect.assertions(0);

    function Button({
      element,
    }: RendererComponentProps<typeof registryCatalog.components.Button>) {
      return createElement("button", null, element.props.label);
    }

    function Container({
      element,
      children,
    }: RendererComponentProps<typeof registryCatalog.components.Container>) {
      return createElement(
        "div",
        { style: { padding: element.props.padding } },
        children
      );
    }

    function Extra() {
      return createElement("div", null, "extra");
    }

    const _registry = createRegistry(registryCatalog, {
      Button,
      Container,
      // @ts-expect-error - Extra is not in catalog
      Extra,
    });
  });
});
