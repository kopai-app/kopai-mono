# Next.js OpenTelemetry Examples

Complete instrumentation files from the kopai-integration-examples repo.

## Approach 1: @vercel/otel

Minimal setup — one file, server-side only.

### package.json (dependencies)

```json
{
  "dependencies": {
    "@vercel/otel": "^2.1.1",
    "next": "^15.5.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

### src/instrumentation.ts

```typescript
import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({ serviceName: "nextjs-vercel-otel-example" });
}
```

No `next.config.ts` changes needed — default config works.

---

## Approach 2: Manual SDK (Server + Browser)

Full control, distributed tracing across server and browser.

### package.json (dependencies)

```json
{
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/context-zone": "^2.0.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.212.0",
    "@opentelemetry/instrumentation": "^0.212.0",
    "@opentelemetry/instrumentation-document-load": "^0.43.0",
    "@opentelemetry/instrumentation-fetch": "^0.212.0",
    "@opentelemetry/resources": "^2.0.0",
    "@opentelemetry/sdk-node": "^0.212.0",
    "@opentelemetry/sdk-trace-base": "^2.0.0",
    "@opentelemetry/sdk-trace-node": "^2.0.0",
    "@opentelemetry/sdk-trace-web": "^2.0.0",
    "@opentelemetry/semantic-conventions": "^1.30.0",
    "next": "^15.5.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

### next.config.ts

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

### src/instrumentation.ts

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}
```

### src/instrumentation.node.ts

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

### src/app/otel-provider.tsx

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

export default function OtelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    try {
      const exporter = new OTLPTraceExporter({
        url: "/api/otel",
      });

      const provider = new WebTracerProvider({
        resource: resourceFromAttributes({
          [ATTR_SERVICE_NAME]: "client-side",
        }),
        spanProcessors: [new BatchSpanProcessor(exporter)],
      });

      provider.register({
        contextManager: new ZoneContextManager(),
      });

      registerInstrumentations({
        instrumentations: [
          new DocumentLoadInstrumentation(),
          new FetchInstrumentation({
            propagateTraceHeaderCorsUrls: [/.*/],
            ignoreUrls: [/\/api\/otel/],
          }),
        ],
      });

      console.log("[OTel] Browser instrumentation initialized");
    } catch (err) {
      console.error("[OTel] Browser instrumentation failed", err);
    }
  }, []);

  return <>{children}</>;
}
```

### src/app/layout.tsx

```typescript
import "./globals.css";
import OtelProvider from "./otel-provider";

export const metadata = {
  title: "Next.js Manual SDK Example",
  description: "OpenTelemetry with manual SDK setup",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 antialiased">
        <OtelProvider>{children}</OtelProvider>
      </body>
    </html>
  );
}
```

### src/app/api/otel/route.ts

OTLP proxy — browser traces go through same-origin API route to avoid CORS.

```typescript
import { NextResponse } from "next/server";

// Same-origin proxy for browser OTel traces.
// Browser can't send directly to the collector (localhost:4318) due to CORS,
// so traces go: browser → /api/otel (same origin) → collector.
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

---

## Validation

Both approaches use the same validation flow:

```bash
# 1. Start Kopai backend
npx @kopai/app start

# 2. Set endpoint and run the app
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
pnpm dev

# 3. Generate traffic — open http://localhost:3000 and interact with the app

# 4. Validate traces
npx @kopai/cli traces search --service server-side --json
npx @kopai/cli traces search --service client-side --json
npx @kopai/cli traces get <trace-id>

# 5. Dashboard — http://localhost:8000
```
