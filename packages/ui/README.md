# @kopai/ui

React component library for rendering LLM-generated UI trees. Define typed component catalogs, create renderers, and generate prompt instructions for AI models.

## Exports

| Export                       | Type      | Description                                             |
| ---------------------------- | --------- | ------------------------------------------------------- |
| `createCatalog`              | function  | Creates typed component catalog with validation schema  |
| `createRendererFromCatalog`  | function  | Creates renderer bound to catalog                       |
| `generatePromptInstructions` | function  | Generates LLM prompt from catalog                       |
| `Renderer`                   | component | Low-level renderer (prefer `createRendererFromCatalog`) |
| `RendererComponentProps`     | type      | Props type for component implementations                |
| `uiPlugin`                   | function  | Fastify plugin for serving UI                           |
| `KopaiSDKProvider`           | component | React context provider for SDK                          |
| `useKopaiSDK`                | hook      | Access SDK client in components                         |

## Example

```tsx
import { z } from "zod";
import {
  createCatalog,
  createRendererFromCatalog,
  generatePromptInstructions,
  type RendererComponentProps,
} from "@kopai/ui";

// 1. Create catalog with typed components
const catalog = createCatalog({
  name: "my-catalog",
  components: {
    Card: {
      hasChildren: true,
      description: "Container card",
      props: z.object({
        title: z.string().nullable(),
      }),
    },
    Text: {
      hasChildren: false,
      description: "Text content",
      props: z.object({
        content: z.string(),
      }),
    },
  },
});

// 2. Define components using RendererComponentProps
function Card({
  element,
  children,
}: RendererComponentProps<typeof catalog.components.Card>) {
  return (
    <div className="card">
      {element.props.title && <h2>{element.props.title}</h2>}
      {children}
    </div>
  );
}

function Text({
  element,
}: RendererComponentProps<typeof catalog.components.Text>) {
  return <p>{element.props.content}</p>;
}

// 3. Create renderer
const MyRenderer = createRendererFromCatalog(catalog, { Card, Text });

// 4. Generate prompt instructions for LLM
const instructions = generatePromptInstructions(catalog);

// 5. Render UITree from LLM
const tree = {
  root: "card-1",
  elements: {
    "card-1": {
      key: "card-1",
      type: "Card",
      props: { title: "Hello" },
      children: ["text-1"],
      parentKey: "",
    },
    "text-1": {
      key: "text-1",
      type: "Text",
      props: { content: "World" },
      children: [],
      parentKey: "card-1",
    },
  },
};

function App() {
  return <MyRenderer tree={tree} />;
}
```

## Data Fetching

Components can receive data via `dataSource`. The renderer uses `useKopaiData` hook internally:

```tsx
function Table({
  element,
  hasData,
  data,
  loading,
  error,
  refetch,
}: RendererComponentProps<typeof catalog.components.Table>) {
  if (!hasData) return null;
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <table>{/* render data */}</table>;
}
```

Wrap your app with `KopaiSDKProvider` to enable data fetching:

```tsx
import { KopaiSDKProvider } from "@kopai/ui";
import { createKopaiClient } from "@kopai/sdk";

const client = createKopaiClient({ baseUrl: "..." });

function App() {
  return (
    <KopaiSDKProvider client={client}>
      <MyRenderer tree={tree} />
    </KopaiSDKProvider>
  );
}
```
