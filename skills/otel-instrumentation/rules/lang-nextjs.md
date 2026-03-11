| title                   | impact | tags                                         |
| ----------------------- | ------ | -------------------------------------------- |
| Next.js Instrumentation | HIGH   | lang, nextjs, react, traces, browser, server |

## Next.js Instrumentation

**Impact:** HIGH

Set up OpenTelemetry for Next.js App Router — two approaches: `@vercel/otel` (simple) or manual SDK (full control, browser+server).

### Approach 1: @vercel/otel (Recommended Start)

Minimal setup, server-side traces only.

**Install:**

```bash
pnpm add @vercel/otel
```

**`src/instrumentation.ts`:**

```typescript
import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({ serviceName: "my-nextjs-app" });
}
```

No `next.config.ts` changes needed.

### Approach 2: Manual SDK (Server + Browser)

Full control over both server-side and client-side instrumentation with distributed tracing.

**Install:**

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/sdk-trace-node \
  @opentelemetry/sdk-trace-web @opentelemetry/sdk-trace-base \
  @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources \
  @opentelemetry/semantic-conventions @opentelemetry/context-zone \
  @opentelemetry/instrumentation @opentelemetry/instrumentation-fetch \
  @opentelemetry/instrumentation-document-load
```

**`next.config.ts`** — externalize Node SDK packages:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@opentelemetry/sdk-node",
    "@opentelemetry/sdk-trace-node",
  ],
};

export default nextConfig;
```

**`src/instrumentation.ts`** — runtime check + dynamic import:

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}
```

**`src/instrumentation.node.ts`** — server-side NodeSDK:

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "server-side",
  }),
  spanProcessor: new SimpleSpanProcessor(new OTLPTraceExporter()),
});

try {
  sdk.start();
} catch (err) {
  console.error("OTel SDK start failed", err);
}

process.on("SIGTERM", () => {
  sdk.shutdown().catch(() => process.exit(0));
});
```

**`src/app/otel-provider.tsx`** — browser-side WebTracerProvider (client component):

```typescript
"use client";

import { useEffect, useRef } from "react";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";

export default function OtelProvider({ children }: { children: React.ReactNode }) {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const exporter = new OTLPTraceExporter({ url: "/api/otel" });
    const provider = new WebTracerProvider({
      resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "client-side" }),
      spanProcessors: [new BatchSpanProcessor(exporter)],
    });

    provider.register({ contextManager: new ZoneContextManager() });

    registerInstrumentations({
      instrumentations: [
        new DocumentLoadInstrumentation(),
        new FetchInstrumentation({
          propagateTraceHeaderCorsUrls: [/.*/],
          ignoreUrls: [/\/api\/otel/],
        }),
      ],
    });
  }, []);

  return <>{children}</>;
}
```

**`src/app/layout.tsx`** — wrap app with OtelProvider:

```typescript
import OtelProvider from "./otel-provider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <OtelProvider>{children}</OtelProvider>
      </body>
    </html>
  );
}
```

**`src/app/api/otel/route.ts`** — OTLP proxy (browser can't reach collector directly due to CORS):

```typescript
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318";
  const body = await request.arrayBuffer();

  const res = await fetch(`${endpoint}/v1/traces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  return new NextResponse(null, { status: res.status });
}
```

### Key Concepts

- **`src/instrumentation.ts`** is a Next.js convention — runs at server startup
- **`NEXT_RUNTIME` check** prevents Node SDK from loading in edge runtime
- **`serverExternalPackages`** prevents Next.js from bundling Node-only OTel packages
- **Browser → `/api/otel` → collector** proxy pattern avoids CORS issues
- **`propagateTraceHeaderCorsUrls`** injects `traceparent` headers in fetch calls, linking browser and server spans into distributed traces
- **`ignoreUrls: [/\/api\/otel/]`** prevents infinite loop (don't trace the trace-export request)

### What Gets Instrumented

| Approach     | Signal         | Description                                              |
| ------------ | -------------- | -------------------------------------------------------- |
| @vercel/otel | Server traces  | HTTP spans, route handlers                               |
| Manual SDK   | Server traces  | HTTP spans via @opentelemetry/sdk-node                   |
| Manual SDK   | Browser traces | Page load + fetch spans via @opentelemetry/sdk-trace-web |

Browser fetch calls inject `traceparent` headers, so server spans appear as children of browser spans — creating end-to-end distributed traces.

### Validate

1. Start the Kopai backend:

```bash
npx @kopai/app start
```

2. Set environment and run the app:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
pnpm dev
```

3. Generate traffic by opening http://localhost:3000 and interacting with the app.

4. Validate traces are received:

```bash
# Search for traces from your service
npx @kopai/cli traces search --service server-side --json
npx @kopai/cli traces search --service client-side --json

# Inspect a specific trace
npx @kopai/cli traces get <trace-id>
```

### Example

See the complete working examples:

- [@vercel/otel approach](https://github.com/kopai-app/kopai-integration-examples/tree/main/next-js/vercel-otel)
- [Manual SDK approach](https://github.com/kopai-app/kopai-integration-examples/tree/main/next-js/manual-sdk)

### Reference

- [Next.js OpenTelemetry Guide](https://nextjs.org/docs/app/guides/open-telemetry)
- [@vercel/otel](https://www.npmjs.com/package/@vercel/otel)
- [@opentelemetry/sdk-node](https://www.npmjs.com/package/@opentelemetry/sdk-node)
