# UiTree examples

The goal of uiTree is to enable server-driven UI. This also makes it possible for a generative generation of the UI. The uiTree has a strict zod schema which is contructed from all the available components in the component catalogue. The LLM can be instructed to use structured output according to the uiTree schema. Instead of emitting prose, the final LLM output is structured data conforming to the uiTree schema.

When the UI receives the uiTree satisfying the schema it knows how to render and has components for, it uses a uiTree renderer.

`@kopai/ui` library provides two functions necessary to crate the renderer:

1. `createCatalog`
2. `createRendererFromCatalog`

First, we need to create a catalog. A catalog is an interface and a schema which defines the contract that a uiTree needs to satisfy.

```typescript
const catalog = createCatalog({
  name: "hello world catalog",
  components: {
    PlainText: {
      description: "displays static textual content",
      hasChildren: false,
      props: z.object({
        content: z.string(),
      }),
    },
  },
});
```

1. examples/ui-react-app/src/static-data.tsx

Demonstrates the simplest possible uiTree
