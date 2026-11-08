# @kopai/ui

[![npm](https://img.shields.io/npm/v/@kopai/ui?label=latest)](https://www.npmjs.com/package/@kopai/ui)

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
| `useOptionalKopaiSDK`        | hook      | SDK client, or `null` outside `KopaiSDKProvider`        |
| `ServiceMap`                 | component | Live service map (lazy-loaded, fetches its own data)    |
| `ServiceMapSourceProvider`   | component | Default data source for every `ServiceMap` below it     |

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

## Service Map

`ServiceMap` shows which services call each other in the past 60 minutes, plus the databases, queues and external APIs they use. It builds itself from trace pages and stays up to date. Its code (engine, layout, React Flow view, Web Worker) is loaded the first time a map renders. Import `@kopai/ui/globals.css` for its styles.

```tsx
import { ServiceMap, KopaiSDKProvider } from "@kopai/ui";

// Inside a KopaiSDKProvider: reads with the provider's client.
<KopaiSDKProvider client={client}>
  <ServiceMap height={480} onServiceClick={(name) => openTraces(name)} />
</KopaiSDKProvider>;

// Anywhere else: a Web Worker reads from this server.
<ServiceMap baseUrl="https://kopai.example.com" token={token} />;
```

Props: `client` (read in-process with this client), `baseUrl` / `headers` / `token` (read from a Web Worker), `height` (canvas height, default 640 px, or `"fill"` to fill the window), `onServiceClick`, `fallback`. Without `client` or `baseUrl` / `headers` / `token`, it uses the nearest `ServiceMapSourceProvider` source, then the `KopaiSDKProvider` client if there is one, else a worker on the page's origin. Maps with the same source share one scan.

A client cannot cross to a worker, so a map that reads with a client (for example a dashboard tile, which gets the dashboard's client) runs the scan on the main thread. Wrap the dashboard in a `ServiceMapSourceProvider` to send its maps to the worker instead; `ObservabilityPage` does this, so its dashboard tiles share the Service map tab's worker session:

```tsx
<ServiceMapSourceProvider
  source={{ baseUrl: "https://kopai.example.com", token }}
>
  <DynamicDashboard kopaiClient={client} uiTree={tree} />
</ServiceMapSourceProvider>
```

In dashboards, add a `ServiceMap` element (`props: { height: number | null }`, no `dataSource`).

The canvas follows the host's theme: a `.dark` / `.light` class on an ancestor, else `prefers-color-scheme`.

The worker is inlined into the lazy chunk as a string, with its own copies of `@kopai/sdk`, `@kopai/core` and `zod` (a Blob worker cannot import the host's modules). That adds about 200 KB to each of the ESM and CJS builds, downloaded only when a map first renders, and an SDK fix reaches the worker only through a new `@kopai/ui` build.

## AI Dashboard Generation

AI agents can generate valid `uiTree` structures using the schema endpoint:

```bash
# Get component schema, props, and JSON schema for uiTree
npx @kopai/cli dashboards schema --url http://localhost:8000

# Or via API directly
curl http://localhost:8000/dashboards/schema
```

Use the `/create-dashboard` skill in Claude Code for guided dashboard creation with live schema injection.

Install the skill via [skills.sh](https://skills.sh):

```bash
npx skills add https://github.com/kopai-app/kopai-mono/tree/main/skills/create-dashboard

# Or from a local checkout
npx skills add ./skills/create-dashboard
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
