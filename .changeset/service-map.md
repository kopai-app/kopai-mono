---
"@kopai/ui": minor
"@kopai/ui-core": minor
"@kopai/app": patch
---

Add a Service map tab to the observability page (`?tab=service-map`, Shift+S).

The map shows which services call each other, plus the databases, queues and external APIs they use. It is built in the browser from the last 60 minutes of trace pages through the existing `KopaiClient` methods, so no new endpoint is needed. Every known service (`getServices`) is on the map from the start; the spans work out how they connect. The scan runs in a Web Worker and stays within a fixed request budget (one request at a time, at most 50 per scan). After the scan, the map updates every 10 s with a 30 s delay. The busiest connected service sits in the centre, the services that call it are on the left and the ones it calls are on the right. Services with no known connection wait in a tray below the map. Nodes and edges dim once their traffic is older than 60 minutes. Find, Fit and zoom reach every node, at any size. Hovering a service highlights its connections, and clicking it opens its traces. Leaving the tab pauses the map; coming back shows it at once and continues the scan.

`ObservabilityPage` gains an optional `serviceMapWorker` prop (`{ baseUrl, headers?, token? }`). When a custom `client` is passed, the map runs on the main thread with that client unless `serviceMapWorker` says where the worker should connect.

The map is also a standalone component: `import { ServiceMap } from "@kopai/ui"`. It reads from its `client` prop, or from a Web Worker for `baseUrl` / `headers` / `token`, or from the nearest `KopaiSDKProvider`'s client, or else from a worker on the page's origin. Other props: `height` (CSS height of the canvas, default 640 px, or `"fill"`), `onServiceClick(service)` and `fallback`. Its code is loaded lazily on first render, and maps with the same source share one scan.

Dashboards can show it too: the observability catalog has a new `ServiceMap` component (`props: { height: number | null }`, no `dataSource`; it fetches its own data with the dashboard's client), and `DynamicDashboard` renders it. `@kopai/ui-core` also exports `useOptionalKopaiSDK()`, which returns the provider's client or `null` outside a `KopaiSDKProvider`.
